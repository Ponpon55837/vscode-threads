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
