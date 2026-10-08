'use strict';

export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: options.credentials || 'same-origin',
    cache: options.cache || 'no-store',
    headers: {
      ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!response.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.error || payload?.message;
    throw new Error(message || \`Request failed (\${response.status})\`);
  }

  return payload;
}

export async function postJson(url, body) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
