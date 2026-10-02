# Turning the contact form on — a plain-English checklist

**Status as of 2026-10-02:** the Cloudflare Pages project **`cifhf-demo`**
already exists, is already connected to this GitHub repo, with production
branch `master`. **Any merge to `master` auto-deploys to
https://cifhf-demo.pages.dev** — there is no separate "create the project"
step left to do. Email sending is **not** configured yet (it waits on
Melanie's domain/recipient decisions below), and the code is written so
that matters: until it's configured, the live site correctly shows the
honest "not connected yet" note and a disabled Send button, in both
languages, even once this branch is merged and deployed.

Nothing below changes that by itself — it only matters once the decisions
marked **PETER/MELANIE DECIDES** are made and acted on.

## The decisions (not code — these are yours to make)

1. **PETER/MELANIE DECIDES: the domain.** Stay on `cifhf-demo.pages.dev`
   (free, already live once merged), or move to a real/custom domain on
   Cloudflare later? The `send_email` binding needs *a* domain on
   Cloudflare with Email Routing enabled — `pages.dev` subdomains can't
   receive mail themselves, so a real domain is needed for the **From**
   side of email even if the site itself keeps living at `pages.dev`.
2. **PETER/MELANIE DECIDES: the recipient address.** Whose inbox should
   contact-form messages land in? (The current Contact page phone number is
   confirmed as the Atlantic Charters office line, not CIFHF's — see the
   stage 1a/1b review notes. The email recipient is a separate, still-open
   question.)
3. **PETER/MELANIE DECIDES: enabling Email Routing + verifying the
   destination.** Once a domain is on Cloudflare, Email Routing has to be
   turned on for it, and the chosen recipient address has to click a
   one-time confirmation email from Cloudflare.
4. **PETER/MELANIE DECIDES: Turnstile (extra spam check), yes or no.** The
   form already has two spam defenses that work with no setup (a honeypot
   field, and a minimum-fill-time check). Turnstile is an additional,
   optional layer — a visible/invisible challenge widget, also free. Skip it
   unless spam becomes a real problem.

## The exact steps to turn it on

~~1. Add the domain to Cloudflare~~ / ~~2. Create the Cloudflare Pages
project~~ — **both already DONE.** `cifhf-demo` exists, is connected to
this GitHub repo, and deploys `master` automatically. What's left is email,
entirely in the Cloudflare dashboard — **no `wrangler.toml` needs to be
added to this repo to do any of it** (see the warning below).

3. **Add a domain for Email Routing** (decision #1) if one isn't already
   on the Cloudflare account — dashboard → Add a Site → nameserver setup.
4. **Turn on Email Routing** for that domain — dashboard → the domain →
   Email → Email Routing → Enable.
5. **Add the destination address** (decision #2) under Email Routing →
   Destination addresses, and click the confirmation link Cloudflare
   emails to it.
6. **Add the `send_email` binding** — in the `cifhf-demo` Pages project →
   Settings → Functions → Email bindings, bind a variable named
   `SEND_EMAIL` to the destination address from step 5. (`wrangler.toml.template`
   at the repo root documents this as a commented-out `[[send_email]]`
   block — it's reference only, see the warning below; do this in the
   dashboard, not by adding a real `wrangler.toml`.)
7. **Set the environment variables** in the `cifhf-demo` Pages project →
   Settings → Environment variables:
   - `CONTACT_TO` — the recipient address from decision #2 (must match the
     verified destination from step 5).
   - `SEND_FROM` — an address on the Cloudflare-managed domain from step 3
     (Email Routing requires the "From" address to be on a domain Cloudflare
     controls).
   - `TURNSTILE_SECRET_KEY` — only if decision #4 was yes. Leave it unset
     otherwise; the form works fine without it.
8. **Merge this branch to `master`.** That alone triggers the auto-deploy
   to `cifhf-demo.pages.dev` — no separate deploy command needed, since the
   GitHub connection already exists. (Still Peter's call on timing — not
   done as part of this stage.)

## ⚠️ About `wrangler.toml.template`

That file is **reference only** and is named `.template` on purpose — it
is NOT read by Cloudflare Pages as-is. **Do not rename it to
`wrangler.toml` and commit that.** If a real `wrangler.toml` ever exists at
the repo root, Cloudflare Pages reads it on every deploy and it becomes
authoritative: its `[vars]` would overwrite/lock whatever is set in the
dashboard (so the real `CONTACT_TO`/`SEND_FROM` typed into step 7 above
could get silently reset to the template's placeholder strings on the next
deploy), and its `name` has to exactly match the real project name
(`cifhf-demo`) or Pages may refuse the deploy or create a confusing second
project. Keep configuration in the dashboard; keep this file as a
human-readable record of what the dashboard should contain.

## The 2-minute test, once it's live

1. Open the live Contact page at `https://cifhf-demo.pages.dev` (or
   whatever domain is live then). Before step 7 above is fully done: the
   "not connected yet" note and disabled Send button should still be
   showing, in both languages — this is a feature, not a bug left over
   from testing (`onRequestOptions` deliberately answers 503, not 204,
   until `SEND_EMAIL`/`CONTACT_TO`/`SEND_FROM` are all real values).
2. Once step 7 is fully done: reload the Contact page. The note should be
   gone and the Send button enabled.
3. **Submit the form with real-looking info.** Within a few seconds you
   should see a bilingual thank-you message where the form was, and the
   email should land in the `CONTACT_TO` inbox with the visitor's address
   already set as Reply-To (so replying goes straight to them).
4. **Submit it once more with a field missing**, or temporarily break the
   `CONTACT_TO` value, to see the failure path: the page should show an
   honest "couldn't send, please try again later" message — in English and
   in French — never a success claim. If it ever claims success when the
   email didn't arrive, that's a bug to report immediately, not a minor
   issue — the honesty of this form was the whole point of this stage.

## What's already true without any of the above

- The honeypot and minimum-fill-time spam checks are built into
  `functions/api/contact.js` and need no setup.
- The frontend (`index.html`) already checks whether `/api/contact` is
  genuinely ready (not just "deployed") before enabling the button — a
  half-configured deploy (function live, but `CONTACT_TO`/`SEND_FROM`/
  `SEND_EMAIL` not all set) correctly keeps showing the "not connected yet"
  note rather than enabling a button that would always fail.
- Nothing about this stage pushes anything, merges anything, or costs
  anything by itself.
