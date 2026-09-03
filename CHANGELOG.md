# Changelog

## 0.0.1 — 2026-09-03

Phase 1 feasibility spike.

- Personal-mode Meta OAuth in the system browser.
- HTTPS static callback (`callback/`) that forwards only OAuth result fields to
  `vscode://dgh.vscode-threads-plugin/auth`.
- `registerUriHandler` validates a five-minute `state` nonce before exchanging
  the authorization code. Pending authorization is stored in `globalState` so a
  callback delivered to another window's extension host still resolves.
- App ID, App Secret, and access token are kept in `SecretStorage` only.
- `Search Threads by Keyword` calls `graph.threads.net/keyword_search`
  (`RECENT` / `TOP`) and lists results in a Quick Pick; selecting one opens its
  permalink.
- `Test Static Callback` exercises the browser-to-`vscode://` hop with a dummy
  code against a loopback callback server (`npm run serve:callback`).
- Verified 2026-09-03: Windows delivered the `vscode://` callback to the
  installed extension and `state` validation passed.

Not yet done: a Meta App with the Threads API use case, a deployed HTTPS
callback URL, and a live OAuth + `keyword_search` round trip. See
`SPIKE_REPORT.md`.
