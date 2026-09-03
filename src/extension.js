'use strict';

const crypto = require('node:crypto');
const vscode = require('vscode');
const {
  API_ORIGIN,
  buildAuthorizationUrl,
  buildKeywordSearchUrl,
  parseCallbackQuery,
  sanitizeErrorMessage,
  assertHttpsRedirectUri,
} = require('./core');

const SECRET_APP_ID = 'threadsExplorer.appId';
const SECRET_APP_SECRET = 'threadsExplorer.appSecret';
const SECRET_ACCESS_TOKEN = 'threadsExplorer.accessToken';
const STATE_REDIRECT_URI = 'threadsExplorer.redirectUri';
const STATE_PENDING_AUTH = 'threadsExplorer.pendingAuth';
const CALLBACK_TTL_MS = 5 * 60 * 1000;
const EXTENSION_ID = 'dgh.vscode-threads-plugin';

// The pending authorization (state nonce, timestamp, redirect URI) is kept in
// globalState rather than a module variable: the vscode:// callback can be
// delivered to a different window's extension host than the one that started
// sign-in, and module state is not shared across extension hosts.
function getPendingAuthorization(context) {
  return context.globalState.get(STATE_PENDING_AUTH);
}

function setPendingAuthorization(context, value) {
  return context.globalState.update(STATE_PENDING_AUTH, value);
}

// Test instrumentation. Inert unless THREADS_SPIKE_LOG is set in the process
// environment, which only happens in the isolated OS-callback spike harness.
// Normal users and the packaged VSIX never set it, so this is a no-op in
// production.
const SPIKE_LOG = process.env.THREADS_SPIKE_LOG || '';

function spikeLog(line) {
  if (!SPIKE_LOG) return;
  try {
    require('node:fs').appendFileSync(
      SPIKE_LOG,
      `${new Date().toISOString()} ${line}\n`
    );
  } catch {
    // Best-effort only; never affect extension behaviour.
  }
}

// Seed a pending authorization so the spike harness can exercise the happy path
// of handleUri without a real Meta round trip. Gated on the same env var as
// spikeLog plus an explicit state value.
async function primeSpikeState(context) {
  if (!SPIKE_LOG || !process.env.THREADS_SPIKE_STATE) return;
  const ageMs = Number(process.env.THREADS_SPIKE_AGE_MS || 0);
  const seeded = {
    state: process.env.THREADS_SPIKE_STATE,
    createdAt: Date.now() - ageMs,
    redirectUri:
      process.env.THREADS_SPIKE_REDIRECT_URI ||
      'http://127.0.0.1:8899/callback/',
  };
  await setPendingAuthorization(context, seeded);
  spikeLog(`primed state-len=${seeded.state.length} age-ms=${ageMs}`);
}

function createOutputChannel() {
  return vscode.window.createOutputChannel('Threads Explorer Spike', {
    log: true,
  });
}

async function setupPersonalMode(context) {
  const appId = await vscode.window.showInputBox({
    title: 'Threads Explorer Personal Mode',
    prompt: 'Enter your Threads App ID (not your Threads username)',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'App ID is required.'),
  });
  if (!appId) return;

  const appSecret = await vscode.window.showInputBox({
    title: 'Threads Explorer Personal Mode',
    prompt: 'Enter your Threads App Secret',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim() ? undefined : 'App Secret is required.',
  });
  if (!appSecret) return;

  const previousRedirectUri = context.globalState.get(STATE_REDIRECT_URI, '');
  const redirectUri = await vscode.window.showInputBox({
    title: 'Threads Explorer Personal Mode',
    prompt: 'Enter the deployed HTTPS static callback URL',
    value: previousRedirectUri,
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        assertHttpsRedirectUri(value);
        return undefined;
      } catch (error) {
        return error.message;
      }
    },
  });
  if (!redirectUri) return;

  await context.secrets.store(SECRET_APP_ID, appId.trim());
  await context.secrets.store(SECRET_APP_SECRET, appSecret.trim());
  await context.globalState.update(
    STATE_REDIRECT_URI,
    assertHttpsRedirectUri(redirectUri)
  );
  vscode.window.showInformationMessage(
    'Threads Personal Mode is configured. App credentials are in SecretStorage.'
  );
}

async function signIn(context, output) {
  const [appId, appSecret] = await Promise.all([
    context.secrets.get(SECRET_APP_ID),
    context.secrets.get(SECRET_APP_SECRET),
  ]);
  const redirectUri = context.globalState.get(STATE_REDIRECT_URI);
  if (!appId || !appSecret || !redirectUri) {
    const choice = await vscode.window.showWarningMessage(
      'Personal Mode is not configured.',
      'Set up now'
    );
    if (choice === 'Set up now') await setupPersonalMode(context);
    return;
  }

  const state = crypto.randomBytes(32).toString('base64url');
  await setPendingAuthorization(context, {
    state,
    createdAt: Date.now(),
    redirectUri,
  });
  const authorizationUrl = buildAuthorizationUrl({ appId, redirectUri, state });
  output.info('Opening Threads authorization page.');
  await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.toString()));
}

async function exchangeCodeForToken(context, code, redirectUri) {
  const [appId, appSecret] = await Promise.all([
    context.secrets.get(SECRET_APP_ID),
    context.secrets.get(SECRET_APP_SECRET),
  ]);
  if (!appId || !appSecret) {
    throw new Error('Personal Mode credentials are missing.');
  }

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const response = await fetch(`${API_ORIGIN}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Token exchange failed: ${sanitizeErrorMessage(detail)}`);
  }
  await context.secrets.store(SECRET_ACCESS_TOKEN, payload.access_token);
}

function statesMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function handleUri(context, output, uri) {
  spikeLog(`handleUri authority=${uri.authority} path=${uri.path}`);
  if (uri.authority !== EXTENSION_ID || uri.path !== '/auth') {
    output.warn(`Ignored URI path: ${uri.path}`);
    return;
  }

  const callback = parseCallbackQuery(uri.query);
  if (callback.error) {
    await setPendingAuthorization(context, undefined);
    throw new Error(
      `Threads authorization failed: ${sanitizeErrorMessage(
        callback.errorDescription || callback.error
      )}`
    );
  }
  if (!callback.code || !callback.state) {
    throw new Error('OAuth callback is missing code or state.');
  }
  const pending = getPendingAuthorization(context);
  if (!pending) {
    throw new Error('No OAuth request is pending. Start sign-in again.');
  }
  if (Date.now() - pending.createdAt > CALLBACK_TTL_MS) {
    await setPendingAuthorization(context, undefined);
    throw new Error('OAuth callback expired. Start sign-in again.');
  }
  if (!statesMatch(callback.state, pending.state)) {
    await setPendingAuthorization(context, undefined);
    throw new Error('OAuth callback state does not match.');
  }

  const { redirectUri } = pending;
  await setPendingAuthorization(context, undefined);
  if (callback.spike === 'callback-only') {
    spikeLog('RESULT pass=static-callback state-matched');
    output.info(
      'Static callback -> VS Code UriHandler: PASS (dummy code redacted).'
    );
    vscode.window.showInformationMessage(
      'Threads callback Spike passed: static page returned to VS Code and state matched.'
    );
    return;
  }

  await exchangeCodeForToken(context, callback.code, redirectUri);
  output.info(
    'OAuth code exchange succeeded; access token stored in SecretStorage.'
  );
  vscode.window.showInformationMessage('Threads sign-in completed.');
}

async function testStaticCallback(context, output) {
  const callbackUrl = await vscode.window.showInputBox({
    title: 'Test Static Callback',
    prompt:
      'HTTPS deployed callback URL, or loopback HTTP URL for local mechanics only',
    placeHolder: 'https://example.github.io/threads-explorer/callback/',
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        const parsed = new URL(value);
        const loopback = ['127.0.0.1', 'localhost'].includes(parsed.hostname);
        if (
          parsed.protocol !== 'https:' &&
          !(parsed.protocol === 'http:' && loopback)
        ) {
          return 'Use HTTPS, or HTTP loopback only for the local callback mechanics test.';
        }
        return undefined;
      } catch {
        return 'Enter a valid URL.';
      }
    },
  });
  if (!callbackUrl) return;

  const state = crypto.randomBytes(32).toString('base64url');
  await setPendingAuthorization(context, {
    state,
    createdAt: Date.now(),
    redirectUri: callbackUrl,
  });
  const url = new URL(callbackUrl);
  url.searchParams.set('code', 'SPIKE_DUMMY_CODE');
  url.searchParams.set('state', state);
  url.searchParams.set('spike', 'callback-only');
  output.info(`Opening static callback mechanics test at ${url.origin}.`);
  await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
}

async function keywordSearch(context, output) {
  const accessToken = await context.secrets.get(SECRET_ACCESS_TOKEN);
  if (!accessToken) {
    vscode.window.showWarningMessage('Sign in to Threads before testing search.');
    return;
  }
  const query = await vscode.window.showInputBox({
    title: 'Threads Keyword Search Spike',
    prompt: 'Keyword to search',
    ignoreFocusOut: true,
  });
  if (!query) return;
  const searchType = await vscode.window.showQuickPick(['RECENT', 'TOP'], {
    title: 'Search type',
  });
  if (!searchType) return;

  const url = buildKeywordSearchUrl({ query, searchType });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiError = payload?.error || {};
    throw new Error(
      `Keyword search failed (HTTP ${response.status}, code ${
        apiError.code ?? 'unknown'
      }, subcode ${apiError.error_subcode ?? 'none'}): ${sanitizeErrorMessage(
        apiError.message || 'Unknown Threads API error'
      )}`
    );
  }
  const count = Array.isArray(payload.data) ? payload.data.length : 0;
  output.info(
    `keyword_search succeeded: ${count} result(s). Query text not logged.`
  );
  output.show(true);
  vscode.window.showInformationMessage(
    `Threads keyword_search succeeded with ${count} result(s).`
  );
}

async function disconnect(context) {
  await context.secrets.delete(SECRET_ACCESS_TOKEN);
  vscode.window.showInformationMessage('Threads access token removed.');
}

async function resetPersonalMode(context) {
  await Promise.all([
    context.secrets.delete(SECRET_ACCESS_TOKEN),
    context.secrets.delete(SECRET_APP_SECRET),
    context.secrets.delete(SECRET_APP_ID),
    context.globalState.update(STATE_REDIRECT_URI, undefined),
    setPendingAuthorization(context, undefined),
  ]);
  vscode.window.showInformationMessage(
    'Threads Personal Mode configuration removed.'
  );
}

function registerCommand(context, output, command, handler) {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async () => {
      try {
        await handler();
      } catch (error) {
        const message = sanitizeErrorMessage(error?.message || error);
        output.error(message);
        vscode.window.showErrorMessage(message);
      }
    })
  );
}

function activate(context) {
  const output = createOutputChannel();
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        try {
          await handleUri(context, output, uri);
        } catch (error) {
          const message = sanitizeErrorMessage(error?.message || error);
          spikeLog(`RESULT error=${message}`);
          output.error(message);
          vscode.window.showErrorMessage(message);
        }
      },
    })
  );

  registerCommand(context, output, 'threadsExplorer.setupPersonalMode', () =>
    setupPersonalMode(context)
  );
  registerCommand(context, output, 'threadsExplorer.signIn', () =>
    signIn(context, output)
  );
  registerCommand(context, output, 'threadsExplorer.keywordSearch', () =>
    keywordSearch(context, output)
  );
  registerCommand(context, output, 'threadsExplorer.testStaticCallback', () =>
    testStaticCallback(context, output)
  );
  registerCommand(context, output, 'threadsExplorer.disconnect', () =>
    disconnect(context)
  );
  registerCommand(context, output, 'threadsExplorer.resetPersonalMode', () =>
    resetPersonalMode(context)
  );

  primeSpikeState(context);
  spikeLog('activated');
  output.info('Threads Explorer Spike activated. No credentials are logged.');
}

function deactivate() {}

module.exports = { activate, deactivate };
