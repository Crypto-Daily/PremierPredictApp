'use strict';

function safe(value) {
  return String(value ?? '').replace(/[<>&]/g, '');
}

function extension(path) {
  return String(path || '').split('.').pop().toLowerCase();
}

export function renderArtifacts(data, root) {
  const artifacts = data?.artifacts || [];
  root.innerHTML = artifacts.slice(0, 100).map(item => {
    const raw = item.path || item.name || '';
    const path = encodeURIComponent(raw);
    const name = safe(item.name || String(item.path || 'artifact').split('/').pop());
    return '<div class="artifact-row">' +
      '<a class="artifact-link" href="/api/artifacts/download?path=' + path +
      '" target="_blank" rel="noopener">' + name + '</a>' +
      '<button class="artifact-open" type="button" data-path="' + path +
      '" data-name="' + name + '">View</button></div>';
  }).join('') || '<div class="empty">No artifacts loaded.</div>';

  root.querySelectorAll('.artifact-open').forEach(button => {
    button.addEventListener('click', async () => {
      const preview = document.querySelector('#artifactPreview');
      const body = document.querySelector('#previewBody');
      const title = document.querySelector('#previewName');
      if (!preview || !body || !title) return;

      const rawPath = decodeURIComponent(button.dataset.path || '');
      title.textContent = button.dataset.name || rawPath;
      preview.hidden = false;
      body.innerHTML = '<div class="empty">Loading preview…</div>';

      const ext = extension(rawPath);
      if (['png','jpg','jpeg','webp','gif','svg'].includes(ext)) {
        const src = '/api/artifacts/download?path=' + encodeURIComponent(rawPath) + '&v=' + Date.now();
        body.innerHTML = '<img src="' + src + '" alt="Artifact preview">';
        return;
      }

      if (['txt','md','json','csv','log','js','ts','css','html'].includes(ext)) {
        try {
          const response = await fetch('/api/artifacts/download?path=' + encodeURIComponent(rawPath) + '&v=' + Date.now(), {
            credentials: 'same-origin'
          });
          if (!response.ok) throw new Error('Preview unavailable.');
          const text = await response.text();
          const pre = document.createElement('pre');
          pre.textContent = text.slice(0, 50000);
          body.replaceChildren(pre);
        } catch (error) {
          body.innerHTML = '<div class="empty">' + safe(error.message) + '</div>';
        }
        return;
      }

      body.innerHTML = '<div class="empty">Preview is not available for this file type. Use the download link above.</div>';
    });
  });
}

export function initArtifacts({ app, root, refresh }) {
  const button = document.querySelector('#artifactBtn');
  document.querySelector('#refreshArtifacts')?.addEventListener('click', async () => {\n    const refreshButton = document.querySelector('#refreshArtifacts');\n    if (refreshButton) refreshButton.disabled = true;\n    try { await refresh?.(); }\n    catch (error) { root.innerHTML = '<div class="empty">Could not refresh artifacts: ' + safe(error.message) + '</div>'; }\n    finally { if (refreshButton) refreshButton.disabled = false; }\n  });\n\n  button?.addEventListener('click', () => {
    app.classList.add('inspector-open');
    app.classList.remove('menu-open');
    root.scrollIntoView({ behavior: 'smooth' });
  });

  document.querySelector('#previewClose')?.addEventListener('click', () => {
    const preview = document.querySelector('#artifactPreview');
    if (preview) preview.hidden = true;
  });
}
