#!/usr/bin/env node
'use strict';
/**
 * qa-email-sender.js — emails the daily QA HTML report to the QA Manager.
 * Re-uses the same Resend / nodemailer fallback pattern as backend/src/utils/emailService.js.
 *
 * Reads env from backend/.env (call it from inside backend/ or pass a path).
 *
 * Usage:
 *   node scripts/qa-email-sender.js \
 *     --to balap@iinvsys.com \
 *     --html qa-output/report.html \
 *     --subject-from qa-output/report.subject \
 *     --attach qa-output/jest-junit.xml \
 *     --attach qa-output/qa-summary.csv \
 *     --attach qa-output/sanity.txt \
 *     --attach qa-output/playwright-report.zip
 */
const fs   = require('fs');
const path = require('path');

// Load .env from backend/ if not already loaded
try { require('dotenv').config({ path: path.join(process.cwd(), '.env') }); } catch (_) {}

// ── arg parsing (supports repeated --attach) ────────────────────────────────
const args = { attach: [], to: '' };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  const val  = process.argv[i + 1];
  if (flag === '--attach') { args.attach.push(val); i++; }
  else if (flag.startsWith('--')) { args[flag.slice(2)] = val; i++; }
}

if (!args.to)   { console.error('FATAL: --to required'); process.exit(2); }
if (!args.html) { console.error('FATAL: --html required'); process.exit(2); }

const html      = fs.readFileSync(args.html, 'utf8');
const subject   = args['subject-from']
  ? fs.readFileSync(args['subject-from'], 'utf8').trim()
  : `[IINVSYS QA] ${new Date().toISOString().slice(0, 10)}`;
const recipients = args.to.split(',').map(s => s.trim()).filter(Boolean);

const attachments = args.attach
  .filter(p => p && fs.existsSync(p))
  .map(p => ({
    filename: path.basename(p),
    content:  fs.readFileSync(p),
  }));

const text = stripHtml(html);

(async () => {
  try {
    if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_your_api_key_here') {
      await sendViaResend({ recipients, subject, html, text, attachments });
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      await sendViaSmtp({ recipients, subject, html, text, attachments });
    } else {
      console.error('FATAL: no email transport configured. Set RESEND_API_KEY (preferred) or SMTP_HOST/USER/PASS in backend/.env.');
      process.exit(2);
    }
    console.log(`OK: report emailed to ${recipients.join(', ')} (${attachments.length} attachments)`);
  } catch (err) {
    console.error('FATAL: email send failed —', err && err.message ? err.message : err);
    process.exit(2);
  }
})();

// ── helpers ─────────────────────────────────────────────────────────────────
async function sendViaResend({ recipients, subject, html, text, attachments }) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || process.env.SMTP_FROM || 'IINVSYS QA <onboarding@resend.dev>';
  const r = await resend.emails.send({
    from,
    to:   recipients,
    subject,
    html,
    text,
    attachments: attachments.map(a => ({
      filename: a.filename,
      content:  a.content.toString('base64'),
    })),
  });
  if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
}

async function sendViaSmtp({ recipients, subject, html, text, attachments }) {
  const nodemailer = require('nodemailer');
  const tx = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await tx.verify();
  await tx.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      recipients.join(', '),
    subject,
    html,
    text,
    attachments,
  });
}

function stripHtml(s) {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}
