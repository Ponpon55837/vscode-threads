'use strict';

const AUTHORIZATION_ORIGIN = 'https://www.threads.net';
const API_ORIGIN = 'https://graph.threads.net';
const REQUIRED_SCOPES = Object.freeze(['threads_basic', 'threads_keyword_search']);

function assertHttpsRedirectUri(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Redirect URI must be a valid URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Threads OAuth redirect URI must use HTTPS.');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('Redirect URI must not contain credentials or a fragment.');
  }
  return parsed.toString();
}

function buildAuthorizationUrl({ appId, redirectUri, state }) {
  if (!appId || !state) throw new Error('App ID and state are required.');
  const url = new URL('/oauth/authorize', AUTHORIZATION_ORIGIN);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', assertHttpsRedirectUri(redirectUri));
  url.searchParams.set('scope', REQUIRED_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url;
}

function parseCallbackQuery(query) {
  const params = new URLSearchParams(query);
  return {
    code: params.get('code') || undefined,
    state: params.get('state') || undefined,
    error: params.get('error') || undefined,
    errorDescription: params.get('error_description') || undefined,
    spike: params.get('spike') || undefined,
  };
}

function buildKeywordSearchUrl({ query, searchType = 'RECENT', limit = 20 }) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) throw new Error('Search query is required.');
  if (!['RECENT', 'TOP'].includes(searchType)) {
    throw new Error('Search type must be RECENT or TOP.');
  }
  const url = new URL('/keyword_search', API_ORIGIN);
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('search_type', searchType);
  url.searchParams.set('fields', 'id,username,text,timestamp,permalink,media_type');
  url.searchParams.set('limit', String(limit));
  return url;
}

function sanitizeErrorMessage(value) {
  return String(value || 'Unknown error')
    .replace(/(access_token|client_secret|code)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
}

module.exports = {
  API_ORIGIN,
  AUTHORIZATION_ORIGIN,
  REQUIRED_SCOPES,
  assertHttpsRedirectUri,
  buildAuthorizationUrl,
  buildKeywordSearchUrl,
  parseCallbackQuery,
  sanitizeErrorMessage,
};
