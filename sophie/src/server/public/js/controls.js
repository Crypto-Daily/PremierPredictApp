'use strict';

import { postJson } from './api.js';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function showJarvisImage(image) {
  const preview = document.querySelector('#screenPreview');
  if (!preview || !image) return;
  const src = image.startsWith('data:') ? image : 'data:image/jpeg;base64,' + image;
  preview.innerHTML = '';
  const img = document.createElement('img');
  img.src = src;
  img.alt = 'Latest screen context';
  preview.appendChild(img);
}

function setJarvisState(state, detail = '') {
  const panel = document.querySelector('#jarvisPanel');
  const badge = document.querySelector('#jarvisBadge');
  const label = document.querySelector('#jarvisState');
  const ring = document.querySelector('#jarvisRing');
  if (!panel || !label || !ring) return;
  const active = state === 'Active' || state === 'Analyzing';
  label.textContent = detail ? state + ' · ' + detail : state;
  ring.classList.toggle('active', active);
  panel.hidden = false;
  if (badge) badge.hidden = false;
}

function clearJarvisPreview() {
  const preview = document.querySelector('#screenPreview');
  if (!preview) return;
  preview.innerHTML = '<div class="screen-placeholder"><span>⌗</span><b>Screen context</b><small>Capture your screen with the Screen button.</small></div>';
}

function dataUrlParts(dataUrl) {
  const match = /^data:([^;,]+)?;base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Could not prepare the selected file.');
  return { mimeType: match[1] || 'application/octet-stream', data: match[2] };
}

async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen sharing is not supported here. Upload a screenshot instead.');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false
  });

  try {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('No screen video track was provided.');

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Could not read the captured screen.'));
    });

    await video.play().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 180));

    const width = Math.min(video.videoWidth || 1280, 2560);
    const height = Math.min(video.videoHeight || 720, 1440);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
  } finally {
    stream.getTracks().forEach(track => track.stop());
  }
}

export function initControls({
  api,
  app,
  ensureAccess,
  loadWorkspace,
  onMessage,
  setStatus,
  setMode
}) {
  const $ = selector => document.querySelector(selector);
  const input = $('#input');

  const closePanels = () => {
    app.classList.remove('menu-open', 'inspector-open');
  };

  $('#mobileMenu')?.addEventListener('click', () => {
    app.classList.toggle('menu-open');
    app.classList.remove('inspector-open');
  });

  $('#menuClose')?.addEventListener('click', () => app.classList.remove('menu-open'));

  $('#panelBtn')?.addEventListener('click', () => {
    app.classList.toggle('inspector-open');
    app.classList.remove('menu-open');
  });

  $('#intelligenceBtn')?.addEventListener('click', () => {
    closePanels();
    $('#feed')?.scrollTo({ top: $('#feed').scrollHeight, behavior: 'smooth' });
  });

  $('#artifactBtn')?.addEventListener('click', () => {
    app.classList.add('inspector-open');
    app.classList.remove('menu-open');
    $('#artifacts')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('#diagBtn')?.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;
    app.classList.add('inspector-open');
    app.classList.remove('menu-open');
    try {
      setStatus('Collecting diagnostics…');
      const diagnostics = await api('/api/diagnostics');
      onMessage('assistant', 'Diagnostics\n' + JSON.stringify(diagnostics, null, 2));
      setStatus('Diagnostics complete.');
    } catch (error) {
      setStatus(error.message || 'Diagnostics failed.');
    }
  });

  $('#mode')?.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;
    const button = $('#mode');
    try {
      button.disabled = true;
      setStatus('Switching mode…');
      const current = await api('/api/mode');
      const next = String(current.mode).toUpperCase() === 'JARVIS' ? 'GPT' : 'JARVIS';
      const selected = await postJson('/api/mode', { mode: next });
      setMode(selected);
      setStatus(selected.mode === 'JARVIS'
        ? 'Jarvis Mode enabled. Screen perception is ready.'
        : 'GPT Mode enabled.');
    } catch (error) {
      setStatus(error.message || 'Could not switch mode.');
    } finally {
      button.disabled = false;
    }
  });

  $('#attach')?.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif,.svg,.zip';
    picker.style.display = 'none';
    document.body.appendChild(picker);

    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return;

      if (file.size > 8 * 1024 * 1024) {
        setStatus('File is too large. Maximum upload size is 8 MB.');
        return;
      }

      try {
        setStatus('Uploading ' + file.name + '…');
        const dataUrl = await readFileAsDataUrl(file);
        const parts = dataUrlParts(dataUrl);
        const result = await postJson('/api/upload', {
          name: file.name,
          mimeType: parts.mimeType,
          data: parts.data
        });
        setStatus('Uploaded: ' + result.name);
        await loadWorkspace();
      } catch (error) {
        setStatus('Upload failed: ' + (error.message || 'Unknown error.'));
      }
    }, { once: true });

    picker.click();
  });

  $('#captureAgain')?.addEventListener('click', () => $('#screen')?.click());
  $('#clearScreen')?.addEventListener('click', () => { clearJarvisPreview(); setJarvisState('Active', 'ready for perception'); });

  $('#screen')?.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;

    try {
      const mode = await api('/api/mode');
      if (String(mode.mode).toUpperCase() !== 'JARVIS') {
        setStatus('Switch to Jarvis Mode first, then tap Screen.');
        $('#mode')?.focus();
        return;
      }

      setStatus('Choose the screen or window to share…');
      const image = await captureScreen();
      setStatus('Analyzing your screen with Jarvis…');
      const result = await postJson('/api/jarvis/screen', {
        image,
        question: input?.value?.trim() || undefined
      });

      if (result.text) onMessage('assistant', result.text);
      setJarvisState('Active', 'analysis complete');\n      setStatus('Screen analysis complete.');
      await loadWorkspace();
    } catch (error) {
      setStatus(error.message || 'Screen capture failed.');
    }
  });

  document.querySelectorAll('.chip').forEach(button => {
    button.addEventListener('click', () => {
      input.value = button.dataset.prompt || button.textContent.trim();
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
  });

  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  });

  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('#send')?.click();
    }
  });
}
