'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const FORMATS = new Set(['pdf', 'docx', 'odt', 'html', 'txt', 'xlsx', 'csv', 'pptx']);

module.exports = {
  name: 'doc-convert',
  description: 'Convert a document in the workspace to another format, e.g. "convert report.docx to pdf" (uses LibreOffice).',
  version: '1.0.0',
  requires: ['soffice'],
  risk: 'low',
  triggers: [/^(?:please\s+)?convert\s+(.+?)\s+to\s+(pdf|docx|odt|html|txt|xlsx|csv|pptx)\s*$/i],

  async run({ match, ctx }) {
    const file = match[1].trim().replace(/^["'`]|["'`]$/g, '');
    const format = match[2].toLowerCase();
    if (!FORMATS.has(format)) return { text: `Unsupported target format: ${format}` };

    let source;
    try { source = ctx.resolveArtifact(file); } catch (error) { return { text: `I can only convert files in the Sophie workspace. ${error.message}` }; }

    const outDir = path.join(ctx.workspaceRoot, 'converted');
    fs.mkdirSync(outDir, { recursive: true });

    const result = await new Promise(resolve => {
      execFile('soffice', [
        '-env:UserInstallation=file:///tmp/sophie-libreoffice-profile',
        '--headless', '--convert-to', format, '--outdir', outDir, source
      ], { timeout: 110000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ ok: !error, text: String(stdout || '') + String(stderr || '') });
      });
    });

    const output = path.join(outDir, path.basename(source, path.extname(source)) + '.' + format);
    if (!result.ok || !fs.existsSync(output)) {
      return { text: `⚠️ Conversion failed.\n${ctx.redact(result.text).slice(0, 600)}` };
    }

    const stat = fs.statSync(output);
    return {
      text: `✅ Converted to ${format.toUpperCase()}: converted/${path.basename(output)}`,
      artifacts: [{
        path: 'converted/' + path.basename(output), size: stat.size,
        modifiedAt: stat.mtime.toISOString(), mimeType: ctx.mimeFor(output)
      }]
    };
  }
};
