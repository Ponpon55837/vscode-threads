# Threads Explorer Phase 1 Spike

Minimal VS Code extension proof of concept for a personal Threads API client:

- Meta OAuth in the system browser.
- HTTPS static callback forwards only OAuth result fields to `vscode://dgh.vscode-threads-plugin/auth`.
- The extension validates a five-minute `state` (kept in `globalState`, so a
  callback delivered to another window still resolves) before exchanging the code.
- Threads App ID, App Secret, and access token are stored in VS Code `SecretStorage`.
- No OAuth broker, backend, database, telemetry, cookies, or scraping.
- `keyword_search` supports `RECENT` and `TOP`; results open in a Quick Pick and
  selecting one opens its permalink.

## Commands

All under the `Threads Explorer:` category in the Command Palette.

1. `Setup Personal Mode` — store App ID, App Secret, and the HTTPS callback URL
2. `Sign in with Threads` — start OAuth in the system browser
3. `Search Threads by Keyword` — run `keyword_search` and browse results
4. `Test Static Callback` — exercise the browser-to-`vscode://` hop with a dummy code
5. `Disconnect Account` — delete the stored access token
6. `Reset Personal Mode` — delete all stored configuration

## Develop

- `npm test` — pure-logic unit tests (`src/core.js`, `callback/callback.js`).
- Press `F5` (Run Extension) to launch an Extension Development Host.
- `npm run package` — build `dist/threads-explorer-poc.vsix`.
- `code --install-extension dist/threads-explorer-poc.vsix --force` — sideload it.

## Static callback deployment

Deploy `callback/` as-is on a dedicated HTTPS path. Do not add analytics, tag managers, remote scripts, fonts, error trackers, or another redirect service.

Add the deployed URL verbatim to the Threads API OAuth redirect URLs in Meta App Dashboard. Enter the same URL during `Setup Personal Mode`.

## Local callback mechanics test

This proves the static JavaScript-to-`vscode://` hop with a dummy code. It is not a valid Meta OAuth redirect because it uses loopback HTTP.

```powershell
npm run serve:callback
```

Run `Threads Explorer: Test Static Callback` and enter:

```text
http://127.0.0.1:8899/callback/
```

## Security notes

- Never put App Secret or access tokens in source, `.env`, extension settings, logs, URLs, or VSIX contents.
- The authorization code arrives at the HTTPS callback URL and then the VS Code callback URI. It is single-use and exchanged only after `state` validation.
- Personal Mode is appropriate for one developer using their own Meta App. It is not a safe shared-secret architecture for a public multi-user Marketplace extension.
- For public distribution, use a trusted backend for confidential-client exchange or a future Meta-supported public-client flow.
