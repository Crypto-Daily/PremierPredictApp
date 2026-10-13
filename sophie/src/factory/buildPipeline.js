'use strict';

const factory = require('./capabilityFactory');
const { verifyFiles } = require('./sandboxRunner');

async function buildAndVerify(projectId, files, options = {}) {
  let project = factory.getProjectById(projectId);
  if (project.state === 'approved') project = factory.startBuild(projectId);
  if (project.state !== 'building') {
    throw new Error('An explicitly approved project must be in the building state before verification.');
  }
  if (!Array.isArray(files) || files.length === 0) {
    const failed = { ok: false, verified: false, stage: 'input', exitCode: 2, timedOut: false, stdout: '', stderr: 'No source files were supplied.' };
    const updated = factory.recordBuildResult(projectId, { ok: false, summary: failed.stderr, files: [] });
    return { project: updated, verification: failed };
  }
  const names = files.map(file => file && file.path).filter(path => typeof path === 'string');
  const verification = await verifyFiles({ files, timeoutMs: options.timeoutMs });
  const built = factory.recordBuildResult(projectId, {
    ok: verification.verified === true,
    summary: verification.verified ? 'Submitted source passed sandbox verification.' : 'Sandbox verification failed; capability was not published.',
    files: names
  });
  let completed = built;
  if (built.state === 'testing') {
    completed = factory.recordTestResult(projectId, {
      passed: verification.verified === true,
      summary: verification.verified ? 'Sandbox checks and configured tests passed.' : 'Sandbox checks or configured tests failed.',
      checks: [verification.stage || 'sandbox', verification.verified ? 'passed' : 'failed'],
      runtime: verification.sandbox || 'docker-sandbox'
    });
  }
  return { project: completed, verification };
}

module.exports = { buildAndVerify };
