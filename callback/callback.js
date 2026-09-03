'use strict';

(() => {
  const extensionId = 'dgh.vscode-threads-plugin';
  const status = document.getElementById('status');
  const continueLink = document.getElementById('continue');
  const input = new URLSearchParams(window.location.search);
  const output = new URLSearchParams();

  for (const key of ['code', 'state', 'error', 'error_description', 'spike']) {
    const value = input.get(key);
    if (value) output.set(key, value);
  }

  const hasOAuthResult =
    (output.has('code') && output.has('state')) || output.has('error');
  if (!hasOAuthResult) {
    status.textContent = 'The callback is missing an OAuth result.';
    return;
  }

  const target = `vscode://${extensionId}/auth?${output.toString()}`;
  window.history.replaceState(null, '', window.location.pathname);
  continueLink.href = target;
  continueLink.hidden = false;
  status.textContent =
    'If VS Code does not open automatically, use the button below.';
  window.location.replace(target);
})();
