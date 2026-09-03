'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_SCOPES,
  assertHttpsRedirectUri,
  buildAuthorizationUrl,
  buildKeywordSearchUrl,
  parseCallbackQuery,
  sanitizeErrorMessage,
} = require('../src/core');

test('authorization URL requests only Phase 1 scopes and preserves state', () => {
  const url = buildAuthorizationUrl({
    appId: '123456',
    redirectUri: 'https://example.test/callback/',
    state: 'random-state',
  });
  assert.equal(url.origin, 'https://www.threads.net');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), '123456');
  assert.equal(url.searchParams.get('state'), 'random-state');
  assert.deepEqual(url.searchParams.get('scope').split(','), REQUIRED_SCOPES);
});

test('production redirect URI must be HTTPS', () => {
  assert.throws(
    () => assertHttpsRedirectUri('http://localhost/callback'),
    /must use HTTPS/
  );
  assert.equal(
    assertHttpsRedirectUri('https://example.test/callback'),
    'https://example.test/callback'
  );
});

test('callback parser accepts code/state and errors', () => {
  assert.deepEqual(parseCallbackQuery('code=A&state=B'), {
    code: 'A',
    state: 'B',
    error: undefined,
    errorDescription: undefined,
    spike: undefined,
  });
  assert.equal(
    parseCallbackQuery('error=access_denied&error_description=No').error,
    'access_denied'
  );
});

test('keyword search URL uses the official endpoint contract', () => {
  const url = buildKeywordSearchUrl({
    query: 'TypeScript',
    searchType: 'TOP',
    limit: 20,
  });
  assert.equal(url.origin, 'https://graph.threads.net');
  assert.equal(url.pathname, '/keyword_search');
  assert.equal(url.searchParams.get('q'), 'TypeScript');
  assert.equal(url.searchParams.get('search_type'), 'TOP');
  assert.equal(url.searchParams.get('limit'), '20');
});

test('errors redact OAuth secrets and bearer tokens', () => {
  const value = sanitizeErrorMessage(
    'client_secret=abc&access_token=xyz Bearer token-value'
  );
  assert.equal(value.includes('abc'), false);
  assert.equal(value.includes('xyz'), false);
  assert.equal(value.includes('token-value'), false);
});

test('assertHttpsRedirectUri rejects malformed URLs and embedded credentials', () => {
  assert.throws(() => assertHttpsRedirectUri('not a url'), /valid URL/);
  assert.throws(
    () => assertHttpsRedirectUri('https://user:pass@example.test/cb'),
    /must not contain credentials or a fragment/
  );
  assert.throws(
    () => assertHttpsRedirectUri('https://example.test/cb#frag'),
    /must not contain credentials or a fragment/
  );
});

test('buildAuthorizationUrl requires appId and state and asks for a code', () => {
  assert.throws(
    () => buildAuthorizationUrl({ redirectUri: 'https://example.test/cb', state: 's' }),
    /App ID and state are required/
  );
  assert.throws(
    () => buildAuthorizationUrl({ appId: '1', redirectUri: 'https://example.test/cb' }),
    /App ID and state are required/
  );
  const url = buildAuthorizationUrl({
    appId: '1',
    redirectUri: 'https://example.test/cb',
    state: 's',
  });
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('buildKeywordSearchUrl validates input and defaults to RECENT', () => {
  assert.throws(() => buildKeywordSearchUrl({ query: '   ' }), /query is required/);
  assert.throws(
    () => buildKeywordSearchUrl({ query: 'x', searchType: 'NEWEST' }),
    /RECENT or TOP/
  );
  const url = buildKeywordSearchUrl({ query: 'x' });
  assert.equal(url.searchParams.get('search_type'), 'RECENT');
  assert.equal(
    url.searchParams.get('fields'),
    'id,username,text,timestamp,permalink,media_type'
  );
});

test('callback parser passes the spike marker through', () => {
  assert.equal(parseCallbackQuery('code=A&state=B&spike=callback-only').spike, 'callback-only');
});
