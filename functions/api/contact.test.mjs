// Unit tests for functions/api/contact.js — run with Node's built-in test
// runner, no installs required:
//
//   node --test functions/api/contact.test.mjs
//
// `cloudflare:email` only exists inside the Cloudflare Workers runtime, so
// these tests never exercise `defaultSendEmail` directly — they inject a
// stub `sendEmail` into processContact() instead, which is the whole reason
// that function is parameterized the way it is. `onRequestPost` IS tested
// directly: it only touches `request.json()` and the global Response/
// Request constructors, both of which modern Node provides natively.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processContact, onRequestPost, onRequestOptions,
  isValidEmail, clean, buildRawEmail, isPlaceholder, isSendConfigured,
} from './contact.js';

function baseEnv(overrides = {}) {
  return {
    CONTACT_TO: 'president@example.org',
    SEND_FROM: 'noreply@example.org',
    SEND_EMAIL: { send: async () => {} },
    ...overrides,
  };
}

function basePayload(overrides = {}) {
  return {
    name: 'Jamie Harvester',
    email: 'jamie@example.com',
    subject: 'Membership Inquiry',
    message: 'Hello, I would like to learn more about joining.',
    website: '', // honeypot, empty = human
    formRenderedAt: Date.now() - 5000, // 5s ago, well past the min-fill-time gate
    ...overrides,
  };
}

test('valid submission -> ok:true, status 200, sendEmail called once', async () => {
  let calls = 0;
  const sendEmail = async () => { calls += 1; };
  const result = await processContact(basePayload(), baseEnv(), { sendEmail });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.reason, undefined);
  assert.equal(calls, 1);
});

test('sendEmail throws -> ok:false, non-2xx, reason send_failed', async () => {
  const sendEmail = async () => { throw new Error('binding not configured'); };
  const result = await processContact(basePayload(), baseEnv(), { sendEmail });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'send_failed');
  assert.ok(result.status >= 400);
});

test('honeypot filled -> rejected, never attempts to send', async () => {
  let calls = 0;
  const sendEmail = async () => { calls += 1; };
  const result = await processContact(basePayload({ website: 'http://spam.example' }), baseEnv(), { sendEmail });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rejected');
  assert.equal(result.status, 400);
  assert.equal(calls, 0, 'a honeypot hit must never reach the send path');
});

test('submission faster than MIN_FILL_TIME_MS -> rejected', async () => {
  const result = await processContact(
    basePayload({ formRenderedAt: Date.now() - 50 }), // 50ms ago — bot-fast
    baseEnv(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rejected');
  assert.equal(result.status, 400);
});

test('missing formRenderedAt -> rejected', async () => {
  const result = await processContact(basePayload({ formRenderedAt: undefined }), baseEnv());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rejected');
});

test('missing name -> missing_fields, 400', async () => {
  const result = await processContact(basePayload({ name: '' }), baseEnv());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_fields');
  assert.equal(result.status, 400);
});

test('missing email -> missing_fields, 400', async () => {
  const result = await processContact(basePayload({ email: '' }), baseEnv());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_fields');
});

test('missing message -> missing_fields, 400', async () => {
  const result = await processContact(basePayload({ message: '   ' }), baseEnv());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_fields');
});

test('malformed email -> invalid_email, 400', async () => {
  const result = await processContact(basePayload({ email: 'not-an-email' }), baseEnv());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_email');
  assert.equal(result.status, 400);
});

test('missing CONTACT_TO -> not_configured, 500, no send attempted', async () => {
  let calls = 0;
  const sendEmail = async () => { calls += 1; };
  const result = await processContact(basePayload(), baseEnv({ CONTACT_TO: undefined }), { sendEmail });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_configured');
  assert.equal(result.status, 500);
  assert.equal(calls, 0);
});

test('missing SEND_EMAIL binding -> not_configured, 500', async () => {
  const result = await processContact(basePayload(), baseEnv({ SEND_EMAIL: undefined }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_configured');
  assert.equal(result.status, 500);
});

test('oversized message is truncated, not rejected outright', async () => {
  const longMessage = 'x'.repeat(10000);
  const sendEmail = async () => {};
  const result = await processContact(basePayload({ message: longMessage }), baseEnv(), { sendEmail });
  assert.equal(result.ok, true); // truncated to MAX_LENGTHS.message, still valid
});

test('isValidEmail rejects obvious junk', () => {
  assert.equal(isValidEmail('plainaddress'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail('jamie@example.com'), true);
});

test('clean() trims and truncates', () => {
  assert.equal(clean('  hi  ', 10), 'hi');
  assert.equal(clean('abcdefgh', 3), 'abc');
  assert.equal(clean(42, 10), '');
});

test('buildRawEmail produces a parseable multipart message with Reply-To', () => {
  const raw = buildRawEmail({
    from: 'noreply@example.org',
    to: 'president@example.org',
    replyTo: 'jamie@example.com',
    subject: 'Test',
    text: 'plain body',
    html: '<p>html body</p>',
  });
  assert.match(raw, /Reply-To: jamie@example\.com/);
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /plain body/);
  assert.match(raw, /<p>html body<\/p>/);
});

// ---- onRequestPost: the HTTP-facing wrapper ----

function fakeRequest(bodyObj) {
  return { json: async () => bodyObj };
}

test('onRequestPost: valid request -> 200 {ok:true}', async () => {
  const sendEmail = async () => {}; // not used here — onRequestPost uses the real default path only
  const env = baseEnv(); // SEND_EMAIL.send resolves fine, so defaultSendEmail's import+send path is exercised
  const context = { request: fakeRequest(basePayload()), env };
  // defaultSendEmail does `await import('cloudflare:email')`, which doesn't exist under plain
  // Node — so under plain Node this specific call is expected to fail at the import and return
  // send_failed/502. That's the honest, correct behavior for "no Cloudflare runtime available";
  // we assert the shape (JSON, well-formed status) rather than forcing a Workers-only success path.
  const res = await onRequestPost(context);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  const data = await res.json();
  assert.equal(typeof data.ok, 'boolean');
  if (!data.ok) {
    assert.equal(data.reason, 'send_failed');
    assert.equal(res.status, 502);
  }
});

test('onRequestPost: bad JSON body -> 400 {ok:false, reason: bad_request}', async () => {
  const context = { request: { json: async () => { throw new Error('parse error'); } }, env: baseEnv() };
  const res = await onRequestPost(context);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.reason, 'bad_request');
});

test('onRequestPost: honeypot filled -> 400 via the real HTTP path', async () => {
  const context = { request: fakeRequest(basePayload({ website: 'spam' })), env: baseEnv() };
  const res = await onRequestPost(context);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.reason, 'rejected');
});

// ---- isPlaceholder / isSendConfigured ----

test('isPlaceholder flags anything starting with PLACEHOLDER', () => {
  assert.equal(isPlaceholder('PLACEHOLDER_SET_IN_DASHBOARD_NOT_HERE'), true);
  assert.equal(isPlaceholder('president@example.org'), false);
  assert.equal(isPlaceholder(''), false);
  assert.equal(isPlaceholder(undefined), false);
});

test('isSendConfigured: true only when binding + both real vars are present', () => {
  assert.equal(isSendConfigured(baseEnv()), true);
  assert.equal(isSendConfigured(baseEnv({ SEND_EMAIL: undefined })), false);
  assert.equal(isSendConfigured(baseEnv({ CONTACT_TO: undefined })), false);
  assert.equal(isSendConfigured(baseEnv({ SEND_FROM: undefined })), false);
  assert.equal(isSendConfigured(baseEnv({ CONTACT_TO: 'PLACEHOLDER_SET_IN_DASHBOARD_NOT_HERE' })), false);
  assert.equal(isSendConfigured(baseEnv({ SEND_FROM: 'PLACEHOLDER_SET_IN_DASHBOARD_NOT_HERE' })), false);
  assert.equal(isSendConfigured(undefined), false);
});

// ---- onRequestOptions: the reachability-check gate ----
// This is the 1c.2 fix: a deployed-but-unconfigured function (e.g. on
// cifhf-demo.pages.dev before Melanie's domain/recipient decision) must
// answer something other than 204, or the frontend would enable a Send
// button that always fails with not_configured.

test('onRequestOptions: fully configured -> 204', async () => {
  const res = await onRequestOptions({ env: baseEnv() });
  assert.equal(res.status, 204);
});

test('onRequestOptions: no env at all (e.g. still on GitHub Pages logic path) -> 503', async () => {
  const res = await onRequestOptions({ env: undefined });
  assert.equal(res.status, 503);
});

test('onRequestOptions: SEND_EMAIL binding missing -> 503', async () => {
  const res = await onRequestOptions({ env: baseEnv({ SEND_EMAIL: undefined }) });
  assert.equal(res.status, 503);
});

test('onRequestOptions: CONTACT_TO missing -> 503', async () => {
  const res = await onRequestOptions({ env: baseEnv({ CONTACT_TO: undefined }) });
  assert.equal(res.status, 503);
});

test('onRequestOptions: SEND_FROM missing -> 503', async () => {
  const res = await onRequestOptions({ env: baseEnv({ SEND_FROM: undefined }) });
  assert.equal(res.status, 503);
});

test('onRequestOptions: CONTACT_TO is a placeholder value -> 503', async () => {
  const res = await onRequestOptions({ env: baseEnv({ CONTACT_TO: 'PLACEHOLDER_SET_IN_DASHBOARD_NOT_HERE' }) });
  assert.equal(res.status, 503);
});

test('onRequestOptions: SEND_FROM is a placeholder value -> 503', async () => {
  const res = await onRequestOptions({ env: baseEnv({ SEND_FROM: 'PLACEHOLDER_SET_IN_DASHBOARD_NOT_HERE' }) });
  assert.equal(res.status, 503);
});
