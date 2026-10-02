// =============================================================================
// Cloudflare Pages Function — POST /api/contact
//
// Receives the CIFHF website contact form and sends it on via Cloudflare's
// Email Workers `send_email` binding (free tier). The recipient address
// comes from an env var (CONTACT_TO) — never hardcoded here, because the
// real recipient is Peter/Melanie's decision, not made yet (see
// DEPLOY_CONTACT.md at the repo root).
//
// HONESTY RULE: this function returns { ok: true } ONLY after the send
// binding itself resolved without throwing. Every other path — validation
// failure, missing config, a thrown send — returns { ok: false, reason }
// with a non-2xx status. Never report success on failure.
//
// Nothing in this file is deployed by writing it. It only takes effect once
// someone runs `wrangler pages deploy` (or connects the repo in the
// Cloudflare dashboard) with the domain, Email Routing, and CONTACT_TO/
// SEND_FROM env vars configured — all PETER/MELANIE DECIDES items.
// =============================================================================

export const MAX_LENGTHS = {
  name: 200,
  email: 320, // RFC 5321 practical max
  subject: 200,
  message: 5000,
  website: 200, // honeypot — real visitors leave this empty
};

// Humans take at least this long to fill the form; a submission faster than
// this (measured from when the page set `formRenderedAt`) is treated as a bot.
export const MIN_FILL_TIME_MS = 2500;

export function clean(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

export function isValidEmail(email) {
  // Deliberately simple — rejects obvious junk, not a full RFC 5322 parser.
  return (
    typeof email === 'string' &&
    email.length > 0 &&
    email.length <= MAX_LENGTHS.email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// A value that still starts with "PLACEHOLDER" (see wrangler.toml.template)
// is treated as unset -- a reference project could otherwise get copied
// with its placeholder [vars] intact and look "configured" when it isn't.
export function isPlaceholder(value) {
  return typeof value === 'string' && value.startsWith('PLACEHOLDER');
}

// True only when the send path can actually be used: the send_email
// binding exists, and both CONTACT_TO and SEND_FROM are set to real
// (non-placeholder) values. Used both to gate the reachability check
// (onRequestOptions) and the actual send attempt (processContact), so the
// two can never disagree about whether the form is "on".
export function isSendConfigured(env) {
  if (!env) return false;
  if (!env.SEND_EMAIL) return false;
  const to = env.CONTACT_TO;
  const from = env.SEND_FROM;
  if (!to || isPlaceholder(to)) return false;
  if (!from || isPlaceholder(from)) return false;
  return true;
}

// Builds a minimal, dependency-free RFC 822 raw message (text + HTML
// multipart/alternative). No npm package required — EmailMessage just needs
// a valid raw message string; a helper library like `mimetext` is a
// convenience, not a requirement, and skipping it keeps this deployable
// with zero installs.
export function buildRawEmail({ from, to, replyTo, subject, text, html }) {
  const boundary = `cifhf-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return `${headers}\r\n\r\n${body}`;
}

// The real send path, isolated into its own function so processContact can
// be unit-tested with a stub `sendEmail` that never touches `cloudflare:email`
// — a module that only exists inside the Cloudflare Workers runtime and
// can't be resolved by plain Node during local testing.
async function defaultSendEmail({ env, from, to, replyTo, subject, text, html }) {
  const { EmailMessage } = await import('cloudflare:email');
  const raw = buildRawEmail({ from, to, replyTo, subject, text, html });
  const message = new EmailMessage(from, to, raw);
  await env.SEND_EMAIL.send(message);
}

/**
 * Core contact-form logic: validation, spam gates, and the send attempt.
 * Pure-ish (all Cloudflare-specific I/O is behind the injectable `sendEmail`)
 * so it can run under plain Node for unit tests with no installs.
 *
 * @returns {{ ok: boolean, reason?: string, status: number }}
 */
export async function processContact(data, env, { sendEmail = defaultSendEmail, now = Date.now } = {}) {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'bad_request', status: 400 };
  }

  // --- Spam gate 1: honeypot ---
  if (clean(data.website, MAX_LENGTHS.website) !== '') {
    return { ok: false, reason: 'rejected', status: 400 };
  }

  // --- Spam gate 2: minimum fill time ---
  const renderedAt = Number(data.formRenderedAt);
  if (!renderedAt || !Number.isFinite(renderedAt) || now() - renderedAt < MIN_FILL_TIME_MS) {
    return { ok: false, reason: 'rejected', status: 400 };
  }

  // --- Spam gate 3 (optional, inert unless configured): Cloudflare Turnstile.
  // Set env.TURNSTILE_SECRET_KEY and have the frontend send the widget's
  // token as data.turnstileToken to turn this on. ---
  if (env && env.TURNSTILE_SECRET_KEY) {
    const token = typeof data.turnstileToken === 'string' ? data.turnstileToken : '';
    if (!token) {
      return { ok: false, reason: 'rejected', status: 400 };
    }
    try {
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData || !verifyData.success) {
        return { ok: false, reason: 'rejected', status: 400 };
      }
    } catch (e) {
      return { ok: false, reason: 'verification_failed', status: 502 };
    }
  }

  // --- Required-field validation ---
  const name = clean(data.name, MAX_LENGTHS.name);
  const email = clean(data.email, MAX_LENGTHS.email);
  const subject = clean(data.subject, MAX_LENGTHS.subject);
  const message = clean(data.message, MAX_LENGTHS.message);

  if (!name || !email || !message) {
    return { ok: false, reason: 'missing_fields', status: 400 };
  }
  if (!isValidEmail(email)) {
    return { ok: false, reason: 'invalid_email', status: 400 };
  }

  // --- Configuration: recipient + sender are env vars, never hardcoded,
  // and a placeholder value (e.g. copied from wrangler.toml.template)
  // counts as unset, not configured. ---
  if (!isSendConfigured(env)) {
    return { ok: false, reason: 'not_configured', status: 500 };
  }
  const to = env.CONTACT_TO;
  const from = env.SEND_FROM;

  const text =
    `New message from the CIFHF website contact form\n\n` +
    `Name: ${name}\n` +
    `Email: ${email}\n` +
    `Subject: ${subject || '(No subject selected)'}\n\n` +
    `Message:\n${message}\n`;

  const html =
    `<p><strong>New message from the CIFHF website contact form</strong></p>` +
    `<p><strong>Name:</strong> ${escapeHtml(name)}<br>` +
    `<strong>Email:</strong> ${escapeHtml(email)}<br>` +
    `<strong>Subject:</strong> ${escapeHtml(subject || '(No subject selected)')}</p>` +
    `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`;

  try {
    await sendEmail({
      env,
      from,
      to,
      replyTo: email,
      subject: `CIFHF contact form: ${subject || 'General inquiry'}`,
      text,
      html,
    });
  } catch (err) {
    return { ok: false, reason: 'send_failed', status: 502 };
  }

  return { ok: true, status: 200 };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, reason: 'bad_request' }, 400);
  }

  const result = await processContact(data, env);
  const { status, ...body } = result;
  return jsonResponse(body, status);
}

// Answering OPTIONS with exactly 204 gives the frontend's reachability
// check (index.html's endpointReachable()) a specific, deterministic
// signal for "this function is deployed AND the send path actually
// works" -- deliberately not just "not a 404" (some static/dev servers,
// e.g. Python's http.server, answer unimplemented methods with 501
// rather than 404) and deliberately not just "this function exists"
// either: the function can be deployed (e.g. on cifhf-demo.pages.dev)
// before CONTACT_TO/SEND_FROM/the send_email binding are set up, since
// those wait on Melanie's domain/recipient decision. Returning 204 in
// that half-configured state would enable the Send button only to have
// every real submission fail with not_configured -- so this checks
// isSendConfigured() the same way processContact() does, and answers 503
// (Service Unavailable) rather than 204 until it's genuinely ready. The
// frontend then correctly keeps showing the honest "not connected yet"
// note instead of a button that always fails.
export async function onRequestOptions(context) {
  const env = context && context.env;
  if (isSendConfigured(env)) {
    return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
  }
  return new Response(null, { status: 503, headers: { Allow: 'POST, OPTIONS' } });
}
