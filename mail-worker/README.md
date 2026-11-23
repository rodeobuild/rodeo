# rodeo-mail

The inbound half of Rodeo's admin mailbox. Cloudflare Email Routing hands every
message for rodeo.build to this Worker. The Worker posts the raw MIME to the
server's `POST /api/mail/inbound`, which parses, threads and stores it. The
admin page's Mail tab (`/admin#mail`) reads it from there.

## What it does

- Messages over 25 MiB are rejected ("Message too large").
- Otherwise the raw message is posted to `INBOUND_URL` with the bearer secret.
  Each try times out after 15 s. Up to 3 tries, with 1 s and 3 s pauses between
  them, and only on network errors, 429 and 5xx.
- A 2xx answer means stored. With `ALWAYS_FORWARD="1"` and `FORWARD_TO` set, a
  copy is also forwarded there (a failed copy is logged, not thrown).
- Not stored (tries used up, a 4xx such as 401 or 413, or no `INBOUND_SECRET`):
  if `FORWARD_TO` is set and the message can be forwarded, it is forwarded with
  the added header `X-Rodeo-Inbox: not-stored`. Otherwise the handler throws, so
  Email Routing reports a temporary failure and the sender retries.
- One log line per message with the outcome, size and status. No addresses or
  content are logged.

There are no runtime dependencies. The Email Worker types the Worker uses are
declared in `src/index.ts`.

## Files

- `src/index.ts`: the `email()` handler and `handleMail()`.
- `src/index.check.ts`: offline checks with fake messages and a stubbed `fetch`.
- `wrangler.toml`: name `rodeo-mail`, the `INBOUND_URL` and `ALWAYS_FORWARD` vars.

## Checks

```sh
cd mail-worker
npx tsx src/index.check.ts      # or: npm run check
npx -y -p typescript@5.9.3 tsc --noEmit -p mail-worker   # from the repo root
```

The checks need no network and no Cloudflare account.

## Setup, in order

Email Routing must already be enabled for the rodeo.build domain.

1. On the server, set `MAIL_INBOUND_SECRET` to a random value, for example
   `openssl rand -hex 32`. The Worker needs the same value.
2. From `mail-worker/`, while logged in to the Cloudflare account that holds the
   domain:
   ```sh
   npx wrangler deploy
   npx wrangler secret put INBOUND_SECRET   # the value from step 1
   npx wrangler secret put FORWARD_TO       # optional: a verified Email Routing destination
   ```
   `FORWARD_TO` must be a destination address already verified under Email
   Routing. Set `ALWAYS_FORWARD = "1"` in `wrangler.toml` only if you want a copy
   of every stored message there too.
3. In the Cloudflare dashboard, go to Email > Email Routing > Routing rules and
   point the catch-all address (or each address) at the Worker `rodeo-mail`.
   Specific address rules take precedence over the catch-all, so check that no
   older rule for an address still sends it elsewhere.
4. Send a test message to one of the rodeo.build addresses and check that it
   appears under `/admin#mail`.

## Replies and sending

Replies and new mail go out through the server's Cloudflare Email Sending API,
not through this Worker. The server needs `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_EMAIL_TOKEN`. See `docs/PLATFORM.md`.
