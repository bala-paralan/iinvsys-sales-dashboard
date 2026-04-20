'use strict';

/**
 * emailService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Sends reports via Resend (HTTP API – works on Vercel serverless).
 * Falls back to nodemailer SMTP when RESEND_API_KEY is absent (on-premise).
 * ────────────────────────────────────────────────────────────────────────────
 */

/* ── placeholder replacer ── */
function renderTemplate(template, periodicity) {
  const now    = new Date();
  const date   = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const period = periodicity === 'daily'   ? date
               : periodicity === 'weekly'  ? `week ending ${date}`
               : periodicity === 'monthly' ? now.toLocaleDateString('en-IN', { month:'long', year:'numeric' })
               : date;
  const replace = (s) => s.replace(/\{\{date\}\}/g, date).replace(/\{\{period\}\}/g, period);
  return {
    subject: replace(template.subject || 'IINVSYS Sales Report'),
    body:    replace(template.body    || ''),
  };
}

/* ── Resend (HTTP, works on Vercel) ── */
async function sendViaResend({ recipients, subject, body, excelBuffer, filename }) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const from = process.env.RESEND_FROM || process.env.SMTP_FROM || 'IINVSYS Reports <onboarding@resend.dev>';

  const response = await resend.emails.send({
    from,
    to:      recipients,
    subject,
    text:    body,
    attachments: [
      {
        filename,
        content: Buffer.from(excelBuffer).toString('base64'),
      },
    ],
  });

  if (response.error) {
    throw new Error(response.error.message || JSON.stringify(response.error));
  }

  return response;
}

/* ── nodemailer SMTP (on-premise / local) ── */
async function sendViaSmtp({ recipients, subject, body, excelBuffer, filename }) {
  const nodemailer = require('nodemailer');
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(k => !process.env[k]);
  if (missing.length) {
    const err = new Error(
      `SMTP not configured. Missing: ${missing.join(', ')}. ` +
      `Set RESEND_API_KEY for cloud/Vercel deployments or SMTP_* vars for on-premise.`
    );
    err.statusCode = 503;
    throw err;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.verify();
  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      recipients.join(', '),
    subject,
    text:    body,
    attachments: [{ filename, content: excelBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
  });
}

/**
 * Main entry point used by reportController.
 */
async function sendReportEmail({ recipients, template, periodicity, excelBuffer }) {
  if (!recipients || recipients.length === 0) {
    throw new Error('No recipients configured');
  }

  const { subject, body } = renderTemplate(template, periodicity);
  const filename = `IINVSYS_Sales_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;

  if (process.env.RESEND_API_KEY) {
    await sendViaResend({ recipients, subject, body, excelBuffer, filename });
  } else {
    await sendViaSmtp({ recipients, subject, body, excelBuffer, filename });
  }

  return { subject, recipients: recipients.length, filename };
}

module.exports = { sendReportEmail, renderTemplate };
