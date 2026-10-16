'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sophie-factory-test-'));
process.env.SOPHIE_FACTORY_REGISTRY = path.join(temp, 'registry.json');
const factory = require('../src/factory/capabilityFactory');

try {
  const project = factory.createProject({
    name: 'Test capability',
    goal: 'Prove the factory lifecycle enforces approval and test gates.',
    requirements: ['bounded retries'],
    constraints: ['no production writes']
  });
  assert.equal(project.state, 'draft');

  assert.throws(() => factory.startBuild(project.id), /explicitly approved/i);
  assert.throws(() => factory.saveBlueprint(project.id, {
    overview: 'x', modules: [], language: 'Node.js', interfaces: [],
    implementationPlan: 'x', testPlan: 'x'
  }), /Research must be recorded/i);

  factory.saveResearch(project.id, {
    summary: 'Research completed.',
    sources: ['https://example.org/docs'],
    findings: ['Use an isolated runner.']
  });
  factory.saveBlueprint(project.id, {
    overview: 'Test blueprint',
    modules: ['factory lifecycle'],
    language: 'Node.js',
    interfaces: ['local module API'],
    implementationPlan: 'Implement only gated lifecycle tracking.',
    testPlan: 'Run unit tests and syntax checks.',
    risks: ['Generated code must not run in-process.'],
    openQuestions: []
  });
  assert.throws(() => factory.startBuild(project.id), /explicitly approved/i);
  factory.approveBlueprint(project.id, { approved: true, notes: 'Approved for isolated test only.' });
  factory.startBuild(project.id);
  factory.recordBuildResult(project.id, { ok: true, summary: 'Build artifact recorded.', files: ['src/example.js'] });
  assert.throws(() => factory.publishCapability(project.id, {
    endpoint: 'http://127.0.0.1:9999', adapter: 'http-json',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }
  }), /passing tests/i);
  factory.recordTestResult(project.id, {
    passed: true, summary: 'All factory lifecycle checks passed.',
    checks: ['approval gate', 'build gate', 'test gate'], runtime: 'node-test'
  });
  const published = factory.publishCapability(project.id, {
    endpoint: 'http://127.0.0.1:9999', adapter: 'http-json',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }
  });
  assert.equal(published.publishedCapability.enabled, false);
  assert.throws(() => factory.setCapabilityEnabled(project.id, true), /Explicit authorization/i);
  assert.equal(factory.setCapabilityEnabled(project.id, true, { authorized: true, authorizationNote: 'Test-only explicit approval.' }).publishedCapability.enabled, true);
  assert.equal(factory.setCapabilityEnabled(project.id, false).publishedCapability.enabled, false);
  assert.equal(factory.getProjectById(project.id).state, 'disabled');
  assert.equal(factory.listProjects().length, 1);
  console.log('Sophie capability factory tests passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
