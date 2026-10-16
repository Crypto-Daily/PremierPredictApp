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
      '<span class="artifact-link">' + name + '</span>' +
      '<button class="artifact-open" type="button" data-path="' + path +
      '" data-name="' + name + '">View</button></div>';
  }).join('') || '<div class="empty">No artifacts loaded.</div>';

  root.querySelectorAll('.artifact-open').forEach(button => {
    button.addEventListener('click', async () => {
      const viewer = document.querySelector('#imageViewer');
      const title = document.querySelector('#imageViewerTitle');
      const stage = document.querySelector('#imageViewerStage');
      const downloadLink = document.querySelector('#imageViewerOpenFile');
      if (!viewer || !title || !stage || !downloadLink) return;

      const rawPath = decodeURIComponent(button.dataset.path || '');
      const fileName = button.dataset.name || rawPath;
      const src = '/api/artifacts/download?path=' + encodeURIComponent(rawPath) + '&v=' + Date.now();
      title.textContent = fileName;
      stage.replaceChildren();
      downloadLink.href = src;
      downloadLink.download = fileName;
      viewer.hidden = false;
      document.body.classList.add('image-viewer-open');

      const ext = extension(rawPath);
      if (['png','jpg','jpeg','webp','gif','svg','avif','bmp'].includes(ext)) {
        const image = document.createElement('img');
        image.alt = fileName;
        image.src = src;
        image.addEventListener('error', () => {
          stage.textContent = 'This image could not be displayed.';
        }, { once: true });
        stage.append(image);
        return;
      }

      if (['txt','md','json','csv','log','js','ts','css','html','xml','yaml','yml'].includes(ext)) {
        stage.textContent = 'Loading preview…';
        try {
          const response = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) throw new Error('Preview unavailable.');
          const pre = document.createElement('pre');
          pre.textContent = (await response.text()).slice(0, 100000);
          stage.replaceChildren(pre);
        } catch (error) {
          stage.textContent = error.message || 'Preview unavailable.';
        }
        return;
      }

      const note = document.createElement('p');
      note.textContent = 'Preview is not available for this file type.';
      stage.append(note);
    });
  });
}
export function initArtifacts({ app, root, refresh }) {
  const button = document.querySelector('#artifactBtn');
  document.querySelector('#refreshArtifacts')?.addEventListener('click', async () => {
    const refreshButton = document.querySelector('#refreshArtifacts');
    if (refreshButton) refreshButton.disabled = true;
    try { await refresh?.(); }
    catch (error) { root.innerHTML = '<div class="empty">Could not refresh artifacts: ' + safe(error.message) + '</div>'; }
    finally { if (refreshButton) refreshButton.disabled = false; }
  });

  button?.addEventListener('click', () => {
    app.classList.add('inspector-open');
    app.classList.remove('menu-open');
    root.scrollIntoView({ behavior: 'smooth' });
  });

  const viewer = document.querySelector('#imageViewer');
  const closeViewer = () => {
    if (viewer) viewer.hidden = true;
    document.body.classList.remove('image-viewer-open');
  };
  document.querySelector('#imageViewerClose')?.addEventListener('click', closeViewer);
  viewer?.addEventListener('click', event => {
    if (event.target === viewer) closeViewer();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && viewer && !viewer.hidden) closeViewer();
  });
}
