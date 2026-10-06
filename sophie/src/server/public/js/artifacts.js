'use strict';

function safe(value) {
  return String(value ?? '').replace(/[<>&]/g, '');
}

export function renderArtifacts(data, root) {
  const artifacts = data?.artifacts || [];
  root.innerHTML = artifacts.slice(0, 8).map(item => {
    const path = encodeURIComponent(item.path || item.name || '');
    const name = safe(item.name || item.path || 'artifact');
    return '<a class="artifact-link" href="/api/artifacts/download?path=' +
      path + '" target="_blank" rel="noopener">' + name + '</a>';
  }).join('') || '<div class="empty">No artifacts loaded.</div>';
}

export function initArtifacts({ app, root }) {
  const button = document.querySelector('#artifactBtn');
  button?.addEventListener('click', () => {
    app.classList.add('inspector-open');
    app.classList.remove('menu-open');
    root.scrollIntoView({ behavior: 'smooth' });
  });
}
