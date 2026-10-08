'use strict';

export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: options.credentials || 'same-origin',
    cache: options.cache || 'no-store'
  });

  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text();

  if (!response.ok) {
    const message = typeof body === 'object' && body
      ? (body.error || body.message || `Request failed (${response.status})`)
      : String(body || `Request failed (${response.status})`);
    throw new Error(message);
  }

  return body;
}

export async function postJson(url, body) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
