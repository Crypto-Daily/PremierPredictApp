'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const plugins = require('./pluginManager');

// Only these types may be shown inline. Anything else is download-only.
const INLINE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.json': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8'
};
const ACTIVE_CONTENT = new Set(['.html', '.htm', '.svg']);
const MAX_FRAMES = 12;
const MAX_FRAME_BASE64 = 2.5 * 1024 * 1024;

function registerJarvisRoutes(app, { commandProcessor, modeManager, hasUpgradeSession, audit }) {
  const artifacts = require('../core/artifactManager');
  const status = plugins.load();
  console.log(`[PLUGINS] loaded: ${status.loaded.join(', ') || 'none'}${status.errors.length ? ' | errors: ' + status.errors.map(e => e.file).join(', ') : ''}`);

  app.get('/api/artifacts/view', (req, res) => {
    try {
      const file = artifacts.resolveArtifact(req.query.path);
      const ext = path.extname(file).toLowerCase();
      const type = INLINE[ext];
      if (!type) return res.status(415).json({ error: 'This file type cannot be previewed. Use download.' });

      res.setHeader('Content-Type', type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('Content-Disposition', 'inline');
      if (ACTIVE_CONTENT.has(ext)) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals');
      res.sendFile(file);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  app.get('/api/plugins', (req, res) => {
    res.json({ plugins: plugins.list(), errors: plugins.errors() });
  });

  app.post('/api/jarvis/video', async (req, res) => {
    let dir = null;
    try {
      if (!modeManager.isJarvis()) {
        return res.status(409).json({ error: 'Video understanding is available in Jarvis Mode. Switch modes first.' });
      }

      const { frames, question, durationSeconds } = req.body || {};
      if (!Array.isArray(frames) || !frames.length) return res.status(400).json({ error: 'At least one video frame is required.' });
      if (frames.length > MAX_FRAMES) return res.status(400).json({ error: `At most ${MAX_FRAMES} frames are accepted.` });
      if (!frames.every(frame => typeof frame === 'string' && frame.length > 100 && frame.length <= MAX_FRAME_BASE64 && /^[A-Za-z0-9+/=]+$/.test(frame))) {
        return res.status(400).json({ error: 'Frames must be base64-encoded JPEG images under 2.5 MB each.' });
      }

      dir = path.join(process.cwd(), 'data', 'jarvis-captures', 'video-' + randomUUID());
      fs.mkdirSync(dir, { recursive: true });
      const files = frames.map((frame, index) => {
        const file = path.join(dir, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
        fs.writeFileSync(file, Buffer.from(frame, 'base64'));
        return file;
      });

      const ask = typeof question === 'string' && question.trim() ? question.trim().slice(0, 500) : 'Summarize what happens in the video.';
      const length = Number(durationSeconds) > 0 ? ` The video is about ${Math.round(Number(durationSeconds))} seconds long.` : '';
      const command =
        'Analyze a video using your vision capability. ' +
        `The ${files.length} images below are key frames sampled evenly in time order from one video.${length} ` +
        'Audio is not available, so say so if sound matters. Frames: ' + files.join(', ') + '. ' +
        'Describe the sequence of events, notable moments, any on-screen text, and then answer: ' + ask;

      if (audit) audit('jarvis.video', { frames: files.length });
      const controller = new AbortController();
      req.on('close', () => { if (!res.writableEnded) controller.abort(); });

      const result = await commandProcessor.process(command, {
        upgradeAuthorized: hasUpgradeSession(req),
        signal: controller.signal,
        onEvent: () => {}
      });

      res.json({ type: 'jarvis_video', text: result.text, artifacts: result.artifacts || [] });
    } catch (error) {
      console.error('[JARVIS VIDEO] ERROR:', error);
      if (!res.headersSent) res.status(500).json({ error: 'Video analysis failed.', details: error.message });
    } finally {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  });
}

module.exports = { registerJarvisRoutes, INLINE };
