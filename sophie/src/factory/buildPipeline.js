'use strict';

const factory = require('./capabilityFactory');
const { verifyFiles } = require('./sandboxRunner');

// Executes only caller-supplied source files in a disposable sandbox after an
// explicit blueprint approval. This is verification, not a Hermes code generator.
async function buildAndVerify(projectId, files, options = {}) {
  const project = factory.getProjectById(projectId);
  if (project.state !== 'approved' || project.approval?.approved !== true) {
    throw new Error('Explicit blueprint approval is required before sandbox verification.');
  }
  factory.startBuild(projectId);
  let result;
  try {
    result = await verifyFiles({ files, timeoutMs: options.timeoutMs });
  } catch (error) {
    result = { ok: false, verified: false, stage: 'input_validation', stderr: String(error.message || error).slice(0, 12000) };
  }
  const fileNames = Array.isArray(files) ? files.map(file => String(file?.path || '').slice(0, 240)) : [];
  factory.recordBuildResult(projectId, {
    ok: result.ok === true && result.verified === true,
    summary: result.ok === true && result.verified === true
      ? 'Sandbox completed the configured syntax/test checks.'
      : 'Sandbox verification did not pass: ' + String(result.stderr || result.note || result.stage || 'unknown error').slice(0, 3000),
    files: fileNames
  });
  // recordBuildResult advances to testing only on verified success. Failed
  // preflight/builds remain failed and are not misrepresented as test failures.
  if (result.ok === true && result.verified === true) {
    factory.recordTestResult(projectId, {
      passed: true,
      summary: 'Sandbox verification succeeded.',
      checks: ['isolated Docker container', 'network disabled', 'read-only container root', 'resource limits enabled', 'syntax/test command exit code 0'],
      runtime: result.sandbox || 'docker-sandbox'
    });
  }
  return { project: factory.getProjectById(projectId), verification: result };
}

module.exports = { buildAndVerify };
