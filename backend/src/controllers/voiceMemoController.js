'use strict';
const path      = require('path');
const fs        = require('fs');
const VoiceMemo = require('../models/VoiceMemo');
const Lead      = require('../models/Lead');
const Telemetry = require('../models/Telemetry');
const { ok, created, notFound, badRequest } = require('../utils/response');

/* ── Rule-based extraction ─────────────────────────────────────────── */

/* Returns { value, confidence } from transcript for each structured field */
function extractFromTranscript(transcript) {
  const t = transcript.toLowerCase();

  /* Pain points — sentences containing trigger phrases */
  const PAIN_TRIGGERS = [
    'problem', 'issue', 'challenge', 'struggle', 'pain', 'difficult',
    'frustrat', 'concern', 'worry', 'bottleneck', 'slow', 'manual',
  ];
  const sentences = transcript.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const painSentences = sentences.filter(s =>
    PAIN_TRIGGERS.some(kw => s.toLowerCase().includes(kw))
  );
  const painPoints = painSentences.length
    ? { value: painSentences.join('. '), confidence: painSentences.length >= 2 ? 'high' : 'med' }
    : null;

  /* Budget signal — look for currency amounts or explicit tier words */
  let budgetSignal = null;
  const budgetHigh = /\b(large|big|high|enterprise|unlimited)\s*(budget|spend|invest)/i.test(transcript)
    || /[$£€₹]\s*[\d,]{5,}/.test(transcript)
    || /\b[\d,]{5,}\s*(dollars?|rupees?|usd|inr)\b/i.test(transcript);
  const budgetMid = /\b(mid|medium|moderate|reasonable)\s*(budget|spend)/i.test(transcript)
    || /[$£€₹]\s*[\d,]{3,4}/.test(transcript);
  const budgetLow = /\b(small|tight|limited|low|no)\s*(budget|spend)/i.test(transcript)
    || /\bno\s+budget\b/i.test(transcript);
  if      (budgetHigh) budgetSignal = { value: 'high',    confidence: 'high' };
  else if (budgetMid)  budgetSignal = { value: 'mid',     confidence: 'med'  };
  else if (budgetLow)  budgetSignal = { value: 'low',     confidence: 'med'  };
  else if (/budget|spend|invest/i.test(transcript))
    budgetSignal = { value: 'unknown', confidence: 'low' };

  /* Timeline — extract the first time expression */
  let timeline = null;
  const timelineMatch = transcript.match(
    /\b(immediately|asap|urgent|this\s+(week|month|quarter|year)|next\s+(week|month|quarter|year|\d+\s+months?)|\d+\s+(days?|weeks?|months?))\b/i
  );
  if (timelineMatch) {
    timeline = { value: timelineMatch[0], confidence: 'high' };
  } else if (/when|timeline|deadline|by\s+when/i.test(transcript)) {
    /* Generic timeline mention without a concrete value */
    const idx = t.search(/when|timeline|deadline/);
    const snippet = transcript.substring(Math.max(0, idx - 20), idx + 60).trim();
    timeline = { value: snippet, confidence: 'low' };
  }

  /* Decision makers — names/titles after decision-maker phrases */
  let decisionMakers = null;
  const dmMatch = transcript.match(
    /(?:decision\s*maker|approver|approves|sign off|sign-off|ceo|cfo|cto|vp|director|head of)[^.!?]{0,80}/i
  );
  if (dmMatch) {
    decisionMakers = { value: dmMatch[0].trim(), confidence: 'med' };
  }

  /* Next step — sentences with action-oriented verbs */
  const NEXT_TRIGGERS = [
    'follow up', 'follow-up', 'send', 'schedule', 'call back', 'demo',
    'proposal', 'meeting', 'trial', 'pilot', 'next step', 'action',
  ];
  const nextSentences = sentences.filter(s =>
    NEXT_TRIGGERS.some(kw => s.toLowerCase().includes(kw))
  );
  const nextStep = nextSentences.length
    ? { value: nextSentences[0], confidence: nextSentences.length >= 1 ? 'high' : 'med' }
    : null;

  /* Interest level — cold / warm / hot */
  let interestLevel = null;
  const hot  = /\b(very\s+interest|definitely|love\s+(it|this)|ready\s+to\s+buy|want\s+to\s+proceed|sign\s+(up|today)|go\s+ahead)\b/i.test(transcript);
  const cold = /\b(not\s+interest|no\s+thanks|don't\s+need|not\s+now|maybe\s+later|just\s+looking)\b/i.test(transcript);
  const warm = /\b(interest|consider|look\s+into|tell\s+me\s+more|sounds\s+good|makes\s+sense)\b/i.test(transcript);
  if      (hot)  interestLevel = { value: 'hot',  confidence: 'high' };
  else if (cold) interestLevel = { value: 'cold', confidence: 'high' };
  else if (warm) interestLevel = { value: 'warm', confidence: 'med'  };

  return { painPoints, budgetSignal, timeline, decisionMakers, nextStep, interestLevel };
}

/* ── POST /api/leads/:id/voice-memos ────────────────────────────────── */
async function createVoiceMemo(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return notFound(res, 'Lead not found');

    /* Agents can only memo their own leads */
    if (req.user.role === 'agent' && String(lead.assignedAgent) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    /* Referrers can only memo leads they created, scoped to their expo */
    if (req.user.role === 'referrer') {
      const sameCreator = String(lead.createdBy) === String(req.user._id);
      const sameExpo    = String(lead.expo) === String(req.referrerExpoId);
      if (!sameCreator || !sameExpo) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
    }

    const { transcript = '', transcriptLang = 'en', retentionDays, audioDurationSec } = req.body;

    /* audio file — optional multipart upload */
    let audioPath = null;
    if (req.file) {
      const uploadDir = path.join(__dirname, '../../uploads/voice');
      fs.mkdirSync(uploadDir, { recursive: true });
      audioPath = path.join('voice', req.file.filename);
    }

    const extracted = extractFromTranscript(transcript);

    /* Mark previous memos as non-primary */
    await VoiceMemo.updateMany(
      { leadId: req.params.id, isPrimary: true },
      { $set: { isPrimary: false } }
    );

    const memo = await VoiceMemo.create({
      leadId:          req.params.id,
      recordedBy:      req.user._id,
      audioPath,
      audioDurationSec: audioDurationSec || null,
      transcript,
      transcriptLang,
      retentionDays:   retentionDays || 90,
      ...extracted,
    });

    /* Telemetry — AC7 */
    await Telemetry.create({
      eventName:    'voice_memo_recorded',
      userId:       req.user._id,
      leadId:       req.params.id,
      timestampUtc: new Date(),
      metadata: {
        audioDurationSec: audioDurationSec || 0,
        hasTranscript: transcript.length > 0,
        fieldsExtracted: Object.entries(extracted)
          .filter(([, v]) => v !== null).map(([k]) => k),
      },
    }).catch(() => {});

    return created(res, memo, 'Voice memo saved');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/leads/:id/voice-memos ─────────────────────────────────── */
async function listVoiceMemos(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return notFound(res, 'Lead not found');

    /* Agents can only read memos on their own leads */
    if (req.user.role === 'agent' && String(lead.assignedAgent) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    /* Referrers can only read memos on leads they created in their own expo */
    if (req.user.role === 'referrer') {
      const sameCreator = String(lead.createdBy) === String(req.user._id);
      const sameExpo    = String(lead.expo) === String(req.referrerExpoId);
      if (!sameCreator || !sameExpo) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
    }

    const memos = await VoiceMemo.find({ leadId: req.params.id })
      .sort({ createdAt: -1 })
      .populate('recordedBy', 'name initials')
      .lean();

    /* AC7 — PII redaction: strip transcript if flagged */
    const safe = memos.map(m => {
      if (m.piiRedacted) {
        return { ...m, transcript: '[redacted]', audioPath: null };
      }
      return m;
    });

    return ok(res, safe);
  } catch (err) {
    next(err);
  }
}

/* ── PATCH /api/leads/:id/voice-memos/:memoId ───────────────────────── */
async function updateVoiceMemo(req, res, next) {
  try {
    const memo = await VoiceMemo.findOne({ _id: req.params.memoId, leadId: req.params.id });
    if (!memo) return notFound(res, 'Voice memo not found');

    const allowedFields = [
      'painPoints', 'budgetSignal', 'timeline',
      'decisionMakers', 'nextStep', 'interestLevel',
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        /* Mark as corrected when user edits extracted value */
        memo[field] = {
          ...(memo[field] || {}),
          value:         req.body[field].value,
          corrected:     true,
          originalValue: memo[field]?.corrected ? memo[field]?.originalValue : memo[field]?.value,
          confidence:    'high', /* user-verified */
        };
      }
    }

    await memo.save();

    await Telemetry.create({
      eventName:    'voice_memo_field_corrected',
      userId:       req.user._id,
      leadId:       req.params.id,
      timestampUtc: new Date(),
      metadata:     { fields: Object.keys(req.body).filter(k => allowedFields.includes(k)) },
    }).catch(() => {});

    return ok(res, memo, 'Voice memo updated');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads/:id/voice-memos/extract ────────────────────────── */
/* Dry-run extraction without persisting — useful for preview */
async function extractPreview(req, res, next) {
  try {
    const { transcript } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return badRequest(res, 'transcript is required');
    }
    const extracted = extractFromTranscript(transcript);
    return ok(res, extracted);
  } catch (err) {
    next(err);
  }
}

module.exports = { createVoiceMemo, listVoiceMemos, updateVoiceMemo, extractPreview };
