'use strict';

function waitFor(target, event, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { target.removeEventListener(event, ok); reject(new Error('Timed out reading the video.')); }, ms);
    const ok = () => { clearTimeout(timer); resolve(); };
    target.addEventListener(event, ok, { once: true });
  });
}

async function extractFrames(file, setState) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await waitFor(video, 'loadedmetadata', 15000);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read the video length.');

    const count = Math.min(10, Math.max(4, Math.round(duration / 8)));
    const scale = Math.min(1, 1024 / (video.videoWidth || 1024));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((video.videoWidth || 1024) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 576) * scale));
    const context = canvas.getContext('2d');
    const frames = [];

    for (let i = 0; i < count; i++) {
      setState(`Reading video frame ${i + 1} of ${count}…`);
      const seeked = waitFor(video, 'seeked', 10000);
      video.currentTime = Math.min(duration - 0.05, ((i + 0.5) / count) * duration);
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
    }
    return { frames, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function initVideo({ api, ensureAccess, onMessage, setState, loadWorkspace }) {
  const anchor = document.querySelector('#adminBtn') || document.querySelector('#screen') || document.querySelector('#attach');
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'videoBtn';
  button.className = anchor ? anchor.className : '';
  button.textContent = '🎞 Video';
  button.title = 'Analyze a video file (Jarvis Mode)';

  if (anchor) anchor.insertAdjacentElement('afterend', button);
  else document.body.appendChild(button);

  button.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;

    try {
      const mode = await api('/api/mode');
      if (String(mode.mode).toUpperCase() !== 'JARVIS') {
        setState('Switch to Jarvis Mode first, then tap Video.');
        return;
      }
    } catch (error) {
      setState(error.message || 'Could not check the mode.');
      return;
    }

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'video/*';
    picker.style.display = 'none';
    document.body.appendChild(picker);

    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      picker.remove();
      if (!file) return;

      try {
        const { frames, duration } = await extractFrames(file, setState);
        setState('Analyzing the video with Jarvis…');
        const question = document.querySelector('#input')?.value?.trim() || undefined;
        const result = await api('/api/jarvis/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames, question, durationSeconds: duration })
        });
        if (result.text) onMessage('assistant', result.text);
        setState('Video analysis complete.');
        await loadWorkspace();
      } catch (error) {
        setState(error.message || 'Video analysis failed.');
      }
    }, { once: true });

    picker.click();
  });
}
