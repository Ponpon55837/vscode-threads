'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(
  path.resolve(__dirname, '..', 'callback', 'callback.js'),
  'utf8'
);

function runCallback(search) {
  const nodes = {
    status: { textContent: '' },
    continue: { href: '', hidden: true },
  };
  const calls = { history: [], replace: [] };
  const sandbox = {
    URLSearchParams,
    document: { getElementById: (id) => nodes[id] },
    window: {
      location: {
        search,
        pathname: '/callback/',
        replace: (value) => calls.replace.push(value),
      },
      history: {
        replaceState: (...args) => calls.history.push(args),
      },
    },
  };
  vm.runInNewContext(script, sandbox);
  return { nodes, calls };
}

test('static page forwards code/state to extension URI and scrubs HTTPS URL', () => {
  const { nodes, calls } = runCallback('?code=demo&state=nonce');
  assert.equal(
    calls.replace[0],
    'vscode://dgh.vscode-threads-plugin/auth?code=demo&state=nonce'
  );
  assert.deepEqual(calls.history[0], [null, '', '/callback/']);
  assert.equal(nodes.continue.hidden, false);
});

test('static page refuses a callback without code/state or error', () => {
  const { nodes, calls } = runCallback('?code=demo');
  assert.equal(calls.replace.length, 0);
  assert.match(nodes.status.textContent, /missing/i);
});

test('static page forwards OAuth errors without unrelated parameters', () => {
  const { calls } = runCallback(
    '?error=access_denied&error_description=Denied&unexpected=secret'
  );
  assert.equal(
    calls.replace[0],
    'vscode://dgh.vscode-threads-plugin/auth?error=access_denied&error_description=Denied'
  );
  assert.equal(calls.replace[0].includes('unexpected'), false);
});
