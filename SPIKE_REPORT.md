# Threads Explorer Phase 1 Spike Report

Date: 2026-09-03 (Asia/Taipei)

No credential, authorization code, or token value is recorded in this report.

## Result summary

| Check | Result | Evidence |
| --- | --- | --- |
| Official `threads_keyword_search` scope and endpoint exist | Confirmed | Meta official Postman workspace and sample |
| App/Tester can grant the scope | Pending interactive Meta login/2FA | App dashboard is not accessible yet |
| Live keyword search | Pending OAuth token | No token was available in source or workspace |
| VS Code UriHandler implementation | Implemented and verified | `onUri` plus `registerUriHandler` for `/auth` |
| OS wakes VS Code via `vscode://` | Verified 2026-09-03 | Packaged VSIX installed in the primary VS Code; local callback page redirected to `vscode://dgh.vscode-threads-plugin/auth?...&spike=callback-only`; Windows shell handler (`Code.exe --open-url -- %1`) delivered it to the extension, which validated `state` and showed "Threads callback Spike passed: static page returned to VS Code and state matched." |
| Static callback forwarding | Implemented and verified | Callback uses an allowlist and scrubs query history; JS-to-`vscode://` hop exercised end to end with a dummy code |
| Pending-state survives window handoff | Fixed 2026-09-03 | First live attempt failed with "No OAuth request is pending" because the callback reached a different window's extension host; pending authorization moved from a module variable to `context.globalState` |
| HTTPS deployed callback to VS Code | Pending deploy/configuration | No public HTTPS callback URL has been selected |
| Secret absent from source/VSIX | Verification pending | Credentials use SecretStorage |
| OAuth Broker/backend | Not created | Static files only |

## Required Meta settings

1. Create or select a Meta App with the Threads API use case.
2. Use the Threads App ID and Threads App Secret, not generic Meta App values.
3. Add the test Threads account as an app role/tester and accept the invitation.
4. Add the exact deployed HTTPS callback URL to the OAuth redirect allowlist.
5. Request `threads_basic,threads_keyword_search`.
6. Keep the authenticating account assigned to the development app. App Review is a separate public-distribution concern.

## Live-test progress (2026-09-03)

- [x] Static callback strips its query from browser history and opens `vscode://dgh.vscode-threads-plugin/auth`.
- [x] Windows delivers the `vscode://` URL to the running VS Code and the extension's `registerUriHandler` runs.
- [x] UriHandler accepts a matching, in-window `state` (dummy `spike=callback-only` path; no code exchange).
- [x] Pending state survives the callback landing in another VS Code window (globalState).
- [ ] UriHandler rejects missing, expired, or mismatched state (covered by unit tests; not yet re-checked live).
- [ ] OAuth consent includes `threads_keyword_search` and returns `code` with the original `state` (needs Meta app + HTTPS callback).
- [ ] Code exchange with App Secret from SecretStorage over HTTPS (needs Meta app).
- [ ] `GET /keyword_search` returns HTTP 200 with a JSON `data` array (needs token).

## Live-test acceptance criteria

- OAuth consent includes `threads_keyword_search` and returns `code` with the original `state`.
- Static callback strips its query from browser history and opens `vscode://dgh.vscode-threads-plugin/auth`.
- UriHandler rejects missing, expired, or mismatched state.
- Code exchange succeeds with App Secret read only from SecretStorage and sent only to Meta over HTTPS.
- `GET /keyword_search?q=<term>&search_type=RECENT&fields=...` returns HTTP 200 and a JSON `data` array.
- Failure evidence records HTTP status, Meta error `code`/`error_subcode`, and a redacted message only.
