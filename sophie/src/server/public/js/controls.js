'use strict';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function dataUrlParts(dataUrl) {
  const match = /^data:([^;,]+)?;base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Could not prepare the selected file.');
  return { mimeType: match[1] || 'application/octet-stream', data: match[2] };
}

async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('This browser does not provide screen capture. Upload a screenshot instead.');
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
    await new Promise(resolve => setTimeout(resolve, 200));

    const width = Math.min(video.videoWidth || 1280, 2560);
    const height = Math.min(video.videoHeight || 720, 1440);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the screen image.');

    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
  } finally {
    stream.getTracks().forEach(track => track.stop());
  }
}

function closeDrawers(app) {
  app?.classList.remove('menu-open', 'inspector-open');
}

function openInspector(app) {
  app?.classList.add('inspector-open');
  app?.classList.remove('menu-open');
}

export function initControls({
  api,
  app,
  input,
  ensureAccess,
  loadWorkspace,
  setStatus,
  setModeLabel,
  onSend,
  onStop,
  onDiagnostics,
  onArtifactFocus
}) {
  const bind = (selector, event, handler) => {
    const node = document.querySelector(selector);
    node?.addEventListener(event, handler);
    return node;
  };

  bind('#mobileMenu', 'click', () => {
    app?.classList.toggle('menu-open');
    app?.classList.remove('inspector-open');
  });

  bind('#menuClose', 'click', () => app?.classList.remove('menu-open'));

  bind('#panelBtn', 'click', () => {
    app?.classList.toggle('inspector-open');
    app?.classList.remove('menu-open');
  });

  bind('#intelligenceBtn', 'click', () => {
    closeDrawers(app);
    document.querySelector('#feed')?.scrollTo({
      top: document.querySelector('#feed')?.scrollHeight || 0,
      behavior: 'smooth'
    });
  });

  bind('#artifactBtn', 'click', () => {
    openInspector(app);
    onArtifactFocus?.();
  });

  bind('#diagBtn', 'click', async () => {
    openInspector(app);
    setStatus('Running diagnostics…');
    try {
      const result = await api('/api/diagnostics');
      onDiagnostics?.(result);
      setStatus('Diagnostics complete.');
    } catch (error) {
      setStatus(error.message || 'Diagnostics failed.');
    }
  });

  bind('#mode', 'click', async event => {
    if (!(await ensureAccess())) return;

    const button = event.currentTarget;
    if (button.dataset.busy === '1') return;

    button.dataset.busy = '1';
    button.setAttribute('aria-busy', 'true');
    setStatus('Switching mode…');

    try {
      const current = await api('/api/mode');
      const next = String(current.mode || '').toUpperCase() === 'JARVIS' ? 'GPT' : 'JARVIS';
      const selected = await api('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next })
      });

      const label = selected.label || selected.name || selected.mode || (next === 'JARVIS' ? 'Jarvis Mode' : 'GPT Mode');
      setModeLabel(label);
      setStatus(next === 'JARVIS'
        ? 'Jarvis Mode enabled. Screen perception is ready.'
        : 'GPT Mode enabled.');
    } catch (error) {
      setStatus(error.message || 'Could not switch mode.');
    } finally {
      delete button.dataset.busy;
      button.removeAttribute('aria-busy');
    }
  });

  bind('#attach', 'click', async () => {
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

        await api('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            mimeType: parts.mimeType,
            data: parts.data
          })
        });

        setStatus('Uploaded: ' + file.name);
        await loadWorkspace();
      } catch (error) {
        setStatus('Upload failed: ' + (error.message || 'Unknown error.'));
      }
    }, { once: true });

    picker.click();
  });

  bind('#screen', 'click', async () => {
    if (!(await ensureAccess())) return;

    try {
      const mode = await api('/api/mode');
      if (String(mode.mode || '').toUpperCase() !== 'JARVIS') {
        setStatus('Switch to Jarvis Mode first, then tap Screen.');
        document.querySelector('#mode')?.focus();
        return;
      }

      setStatus('Choose the screen or window to share…');
      const image = await captureScreen();
      setStatus('Analyzing your screen with Jarvis…');

      const result = await api('/api/jarvis/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          question: input?.value?.trim() || undefined
        })
      });

      if (result.text) onSend?.({ text: result.text, external: true });
      setStatus('Screen analysis complete.');
      await loadWorkspace();
    } catch (error) {
      setStatus(error.message || 'Screen capture failed.');
    }
  });

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent.trim();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  bind('#send', 'click', () => {
    if (onStop?.()) return;
    onSend?.();
  });

  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (onStop?.()) return;
      onSend?.();
    }
  });

  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  });

  setStatus('Ready');
}
