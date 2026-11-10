import type { FormConfig, Payload } from './types';

export interface SubmissionView {
  id: string;
  payload: Payload;
  createdAt: string; // ISO 8601
  origin: string | null;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Slack mrkdwn only needs these three escaped. */
export function escapeSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

function singleLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringifyValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface FieldList {
  fields: Array<{ key: string; value: string }>;
  omitted: number;
}

export function toFields(payload: Payload, maxFields: number, maxValueLength: number): FieldList {
  const entries = Object.entries(payload);
  return {
    fields: entries.slice(0, maxFields).map(([key, value]) => ({
      key: truncate(key, 100),
      value: truncate(stringifyValue(value), maxValueLength),
    })),
    omitted: Math.max(0, entries.length - maxFields),
  };
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** If the submitter gave an email address, use it as Reply-To so "Reply" just works. */
export function findReplyTo(payload: Payload): string | null {
  for (const [key, value] of Object.entries(payload)) {
    const k = key.toLowerCase();
    if ((k === 'email' || k === 'e-mail' || k === '_replyto' || k === '_reply_to') && typeof value === 'string') {
      const candidate = value.trim();
      if (candidate.length <= 254 && EMAIL_RE.test(candidate)) return candidate;
    }
  }
  return null;
}

export function buildEmail(form: FormConfig, view: SubmissionView): { subject: string; html: string; text: string } {
  const name = singleLine(form.name);
  const { fields, omitted } = toFields(view.payload, 100, 5000);

  const rows = fields
    .map(
      (f) =>
        `<tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;vertical-align:top;white-space:nowrap">${escapeHtml(f.key)}</td>` +
        `<td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;white-space:pre-wrap;word-break:break-word">${escapeHtml(f.value) || '&mdash;'}</td></tr>`,
    )
    .join('');
  const omittedNote =
    omitted > 0
      ? `<p style="color:#6b7280;font-size:13px">…and ${omitted} more field${omitted === 1 ? '' : 's'} not shown. Open the dashboard to see everything.</p>`
      : '';
  const originLine = view.origin !== null ? ` &middot; from ${escapeHtml(view.origin)}` : '';

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">` +
    `<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">` +
    `<div style="padding:18px 20px;border-bottom:1px solid #e5e7eb"><div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">New submission</div>` +
    `<div style="font-size:20px;font-weight:700;color:#111827;margin-top:4px">${escapeHtml(name)}</div></div>` +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` +
    `<div style="padding:14px 20px;background:#f9fafb;color:#6b7280;font-size:12px">${omittedNote}` +
    `Received ${escapeHtml(view.createdAt)}${originLine}<br>Submission ID ${escapeHtml(view.id)}</div>` +
    `</div></body></html>`;

  const text =
    `New submission: ${name}\n\n` +
    fields.map((f) => `${f.key}: ${f.value}`).join('\n') +
    (omitted > 0 ? `\n\n…and ${omitted} more field${omitted === 1 ? '' : 's'} not shown.` : '') +
    `\n\nReceived ${view.createdAt}${view.origin !== null ? ` from ${view.origin}` : ''}\nSubmission ID ${view.id}\n`;

  return { subject: truncate(`New submission: ${name}`, 150), html, text };
}

export function buildSlackMessage(form: FormConfig, view: SubmissionView): Record<string, unknown> {
  const name = singleLine(form.name);
  const { fields, omitted } = toFields(view.payload, 20, 500);
  let body = fields.map((f) => `*${escapeSlack(f.key)}*\n${escapeSlack(f.value) || '—'}`).join('\n\n');
  if (omitted > 0) body += `\n\n_…and ${omitted} more field${omitted === 1 ? '' : 's'}_`;
  if (body === '') body = '_(empty submission)_';

  return {
    text: `New submission: ${name}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: truncate(`New submission: ${name}`, 150) } },
      { type: 'section', text: { type: 'mrkdwn', text: truncate(body, 2900) } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Submission \`${view.id}\`` }] },
    ],
  };
}

export function buildDiscordMessage(form: FormConfig, view: SubmissionView): Record<string, unknown> {
  const name = singleLine(form.name);
  const { fields, omitted } = toFields(view.payload, 10, 400);
  return {
    username: 'Auklet Forms',
    // Submitters control the text, so never let it ping @everyone, roles or users.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(`New submission: ${name}`, 200),
        color: 0x2563eb,
        description: omitted > 0 ? `…and ${omitted} more field${omitted === 1 ? '' : 's'} not shown.` : undefined,
        fields: fields.map((f) => ({
          name: truncate(f.key, 256) || '(unnamed)',
          value: f.value === '' ? '—' : f.value,
          inline: false,
        })),
        footer: { text: `Submission ${view.id}` },
        timestamp: view.createdAt,
      },
    ],
  };
}
