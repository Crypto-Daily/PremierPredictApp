'use strict';

function setState(setState, text) {
  if (typeof setState === 'function') setState(text || '');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function dataUrlParts(dataUrl) {
  const match = /^data:([^;,]+)?;base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Could not prepare the selected file.');
  return { mimeType: match[1] || 'application/octet-stream', data: match[2] };
}

function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('This browser does not provide screen capture. Use + File to upload a screenshot instead.');
  }

  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(stream => new Promise((resolve, reject) => {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach(item => item.stop());
      reject(new Error('No screen video track was provided.'));
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    const finish = () => {
      const width = video.videoWidth || track.getSettings?.().width || 1280;
      const height = video.videoHeight || track.getSettings?.().height || 720;
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(width, 2560);
      canvas.height = Math.min(height, 1440);
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach(item => item.stop());
      const encoded = canvas.toDataURL('image/jpeg', 0.86);
      resolve(encoded.split(',')[1]);
    };

    video.onloadedmetadata = () => {
      video.play().then(() => setTimeout(finish, 250)).catch(finish);
    };
    video.onerror = () => {
      stream.getTracks().forEach(item => item.stop());
      reject(new Error('Could not read the captured screen.'));
    };
  }));
}

export function initControls({ api, app, ensureAccess, loadWorkspace, onMessage, setState }) {
  const menu = document.querySelector('#mobileMenu');
  const close = document.querySelector('#menuClose');
  const panel = document.querySelector('#panelBtn');
  const intelligence = document.querySelector('#intelligenceBtn');
  const modeButton = document.querySelector('#mode');
  const attach = document.querySelector('#attach');
  const screen = document.querySelector('#screen');
  const input = document.querySelector('#input');

  menu?.addEventListener('click', () => {
    app.classList.toggle('menu-open');
    app.classList.remove('inspector-open');
  });

  close?.addEventListener('click', () => app.classList.remove('menu-open'));

  panel?.addEventListener('click', () => {
    app.classList.toggle('inspector-open');
    app.classList.remove('menu-open');
  });

  intelligence?.addEventListener('click', () => {
    app.classList.remove('menu-open');
    const feed = document.querySelector('#feed');
    feed?.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  });

  modeButton?.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;
    try {
      modeButton.disabled = true;
      setState(setState, 'Switching mode…');
      const current = await api('/api/mode');
      const next = String(current.mode || '').toUpperCase() === 'JARVIS' ? 'GPT' : 'JARVIS';
      const selected = await api('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next })
      });
      modeButton.textContent = selected.name || (next === 'JARVIS' ? 'Jarvis Mode' : 'GPT Mode');
      const mode2 = document.querySelector('#mode2');
      if (mode2) mode2.textContent = selected.name || modeButton.textContent;
      setState(setState, next === 'JARVIS' ? 'Jarvis Mode enabled. Screen perception is ready.' : 'GPT Mode enabled.');
    } catch (error) {
      setState(setState, error.message || 'Could not switch mode.');
    } finally {
      modeButton.disabled = false;
    }
  });

  attach?.addEventListener('click', async () => {
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
        setState(setState, 'File is too large. Maximum upload size is 8 MB.');
        return;
      }
      try {
        setState(setState, 'Uploading ' + file.name + '…');
        const dataUrl = await readFileAsDataUrl(file);
        const parts = dataUrlParts(dataUrl);
        await api('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, mimeType: parts.mimeType, data: parts.data })
        });
        setState(setState, 'Uploaded: ' + file.name);
        await loadWorkspace();
      } catch (error) {
        setState(setState, 'Upload failed: ' + (error.message || 'Unknown error.'));
      }
    }, { once: true });
    picker.click();
  });

  screen?.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;
    try {
      const mode = await api('/api/mode');
      if (String(mode.mode).toUpperCase() !== 'JARVIS') {
        setState(setState, 'Switch to Jarvis Mode first, then tap Screen.');
        modeButton?.focus();
        return;
      }
      setState(setState, 'Choose the screen or window to share…');
      const image = await captureScreen();
      setState(setState, 'Analyzing your screen with Jarvis…');
      const result = await api('/api/jarvis/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, question: input?.value?.trim() || undefined })
      });
      if (result.text && typeof onMessage === 'function') onMessage('assistant', result.text);
      setState(setState, 'Screen analysis complete.');
      await loadWorkspace();
    } catch (error) {
      setState(setState, error.message || 'Screen capture failed.');
    }
  });
}
