# Turning the contact form on — a plain-English checklist

Today the site is static on GitHub Pages and the contact form is honest
about that: it shows a note saying it isn't connected yet, and the Send
button stays off. Nothing you read below changes that by itself — it only
matters once the decisions marked **PETER/MELANIE DECIDES** are made and
acted on.

## The decisions (not code — these are yours to make)

1. **PETER/MELANIE DECIDES: the domain.** Does the site move to a real
   domain on Cloudflare (so hosting stays free and the form can work), or
   does it stay on `github.io` for now? The form cannot be turned on while
   the site is on GitHub Pages — there's nowhere for `/api/contact` to run.
2. **PETER/MELANIE DECIDES: the recipient address.** Whose inbox should
   contact-form messages land in? (The current Contact page phone number is
   confirmed as the Atlantic Charters office line, not CIFHF's — see the
   stage 1a/1b review notes. The email recipient is a separate, still-open
   question.)
3. **PETER/MELANIE DECIDES: enabling Email Routing + verifying the
   destination.** Once the domain is on Cloudflare, Email Routing has to be
   turned on for it, and the chosen recipient address has to click a
   one-time confirmation email from Cloudflare.
4. **PETER/MELANIE DECIDES: Turnstile (extra spam check), yes or no.** The
   form already has two spam defenses that work with no setup (a honeypot
   field, and a minimum-fill-time check). Turnstile is an additional,
   optional layer — a visible/invisible challenge widget, also free. Skip it
   unless spam becomes a real problem.

## Once those are decided: the exact steps to turn it on

1. **Add the domain to Cloudflare** (if moving off GitHub Pages) —
   Cloudflare dashboard → Add a Site → follow the nameserver instructions.
2. **Create the Cloudflare Pages project** from this repo, or push these
   files to wherever Pages is already pointed. Build output directory is
   the repo root (`.`) — there's no build step, it's static HTML.
3. **Turn on Email Routing** for the domain — dashboard → the domain →
   Email → Email Routing → Enable.
4. **Add the destination address** (decision #2 above) under Email Routing
   → Destination addresses, and click the confirmation link Cloudflare
   emails to it.
5. **Add the `send_email` binding** — in the Cloudflare Pages project →
   Settings → Functions → Email bindings, bind a variable named
   `SEND_EMAIL` to the destination address from step 4. (This is the same
   thing the commented-out `[[send_email]]` block in `wrangler.toml`
   documents — either edit that file and deploy with Wrangler, or set it
   the same way in the dashboard. Don't do both inconsistently.)
6. **Set the environment variables** in the Pages project → Settings →
   Environment variables:
   - `CONTACT_TO` — the recipient address from decision #2 (must match the
     verified destination from step 4).
   - `SEND_FROM` — an address on the Cloudflare-managed domain (Email
     Routing requires the "From" address to be on a domain Cloudflare
     controls).
   - `TURNSTILE_SECRET_KEY` — only if decision #4 was yes. Leave it unset
     otherwise; the form works fine without it.
7. **Deploy.** `wrangler pages deploy .` from this repo, or let Cloudflare's
   GitHub integration deploy on push, once Peter says go to push.

## The 2-minute test, once it's live

1. Open the live Contact page. The "not connected yet" note should be gone
   and the Send button should be enabled (the frontend checks this
   automatically — if the function isn't actually reachable, the note and
   disabled button stay exactly as they are today, in both languages).
2. **Submit the form with real-looking info.** Within a few seconds you
   should see a bilingual thank-you message where the form was, and the
   email should land in the `CONTACT_TO` inbox with the visitor's address
   already set as Reply-To (so replying goes straight to them).
3. **Submit it once more with a field missing**, or temporarily break the
   `CONTACT_TO` value, to see the failure path: the page should show an
   honest "couldn't send, please try again later" message — in English and
   in French — never a success claim. If it ever claims success when the
   email didn't arrive, that's a bug to report immediately, not a minor
   issue — the honesty of this form was the whole point of this stage.

## What's already true without any of the above

- The honeypot and minimum-fill-time spam checks are built into
  `functions/api/contact.js` and need no setup.
- The frontend (`index.html`) already checks whether `/api/contact` is
  reachable before enabling the button — so partially setting this up
  (e.g., the function deployed but `CONTACT_TO` not yet set) will correctly
  show the *failure* message on submit, not a false success, because
  `contact.js` returns `not_configured` until both `CONTACT_TO` and
  `SEND_FROM` are set and the `SEND_EMAIL` binding exists.
- Nothing about this stage changes hosting, pushes anything, or costs
  anything by itself.
