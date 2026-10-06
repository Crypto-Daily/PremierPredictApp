'use strict';

export function initLogin({ api, loadWorkspace }) {
  const login = document.querySelector('#login');
  const button = document.querySelector('#loginBtn');
  const buttonText = document.querySelector('#loginBtnText');
  const password = document.querySelector('#accessPassword');
  const status = document.querySelector('#loginErr');

  async function ensureAccess() {
    const state = await api('/api/access/status', { cache: 'no-store' });
    if (!state.required) {
      login.hidden = true;
      return true;
    }
    if (state.authenticated) {
      login.hidden = true;
      return true;
    }
    login.hidden = false;
    return false;
  }

  async function submit() {
    const value = password.value.trim();
    if (!value) {
      status.className = 'loginerr error';
      status.textContent = 'Please enter your access password.';
      password.focus();
      return false;
    }

    button.disabled = true;
    buttonText.innerHTML = '<span class="login-status"><span class="login-spinner" aria-hidden="true"></span>Checking...</span>';
    status.className = 'loginerr';
    status.textContent = 'Contacting Sophie securely...';

    try {
      await api('/api/access/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ password: value })
      });

      const state = await api('/api/access/status', { cache: 'no-store' });
      if (!state.authenticated) {
        throw new Error('Login succeeded, but the browser session was not accepted.');
      }

      status.className = 'loginerr success';
      status.textContent = '✓ Login successful. Opening Sophie...';
      buttonText.textContent = 'Unlocked';

      await new Promise(resolve => setTimeout(resolve, 350));
      login.hidden = true;
      await loadWorkspace();
      return true;
    } catch (error) {
      status.className = 'loginerr error';
      status.textContent = error?.message || 'Login failed. Please try again.';
      buttonText.textContent = 'Unlock';
      return false;
    } finally {
      button.disabled = false;
    }
  }

  window.sophieUnlock = submit;
  button?.addEventListener('click', submit);
  password?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  return { ensureAccess, submit };
}
