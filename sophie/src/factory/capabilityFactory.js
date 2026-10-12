'use strict';

// Sophie Model Factory: durable lifecycle for user-designed capabilities.
// This module deliberately does not execute generated code. Build execution and
// publication to an executable runtime are separate, gated steps.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const REGISTRY_PATH = process.env.SOPHIE_FACTORY_REGISTRY ||
  path.join(process.cwd(), 'data', 'capability-factory.json');

const STATES = new Set([
  'draft', 'researching', 'blueprint_ready', 'approved',
  'building', 'testing', 'build_failed', 'tested', 'published', 'disabled'
]);
const MAX_NAME = 120;
const MAX_TEXT = 30000;

function ensureStore() {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  if (!fs.existsSync(REGISTRY_PATH)) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify({ version: 1, projects: [] }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
}

function readStore() {
  ensureStore();
  const value = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  if (!value || value.version !== 1 || !Array.isArray(value.projects)) {
    throw new Error('Factory registry is invalid; refusing to overwrite it.');
  }
  return value;
}

function writeStore(store) {
  ensureStore();
  const temporary = REGISTRY_PATH + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, projects: store.projects }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, REGISTRY_PATH);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function requiredText(value, label, max = MAX_TEXT) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  if (value.length > max) throw new Error(label + ' exceeds the ' + max + ' character limit.');
  return value.trim();
}

function safeId(value) {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  if (!id) throw new Error('A valid capability name is required.');
  return id;
}

function publicProject(project) {
  return JSON.parse(JSON.stringify(project));
}

function getProject(store, id) {
  const project = store.projects.find(item => item.id === id);
  if (!project) throw new Error('Factory project not found.');
  return project;
}

function mutateProject(id, mutate) {
  const store = readStore();
  const project = getProject(store, id);
  mutate(project);
  project.updatedAt = new Date().toISOString();
  writeStore(store);
  return publicProject(project);
}

function createProject({ name, goal, requirements = [], constraints = [], createdBy = 'user' } = {}) {
  const cleanName = requiredText(name, 'Project name', MAX_NAME);
  const cleanGoal = requiredText(goal, 'Project goal', 5000);
  if (!Array.isArray(requirements) || requirements.length > 100) throw new Error('Requirements must be an array with at most 100 entries.');
  if (!Array.isArray(constraints) || constraints.length > 100) throw new Error('Constraints must be an array with at most 100 entries.');
  const store = readStore();
  const base = safeId(cleanName);
  let id = base;
  let suffix = 2;
  while (store.projects.some(item => item.id === id)) id = base + '-' + suffix++;
  const now = new Date().toISOString();
  const project = {
    id, name: cleanName, goal: cleanGoal,
    requirements: requirements.map(x => requiredText(String(x), 'Requirement', 1000)),
    constraints: constraints.map(x => requiredText(String(x), 'Constraint', 1000)),
    state: 'draft', revision: 1, research: null, blueprint: null,
    approval: null, build: null, tests: null, publishedCapability: null,
    createdBy: String(createdBy).slice(0, 80), createdAt: now, updatedAt: now
  };
  store.projects.push(project);
  writeStore(store);
  return publicProject(project);
}

function listProjects({ state } = {}) {
  const projects = readStore().projects;
  return projects.filter(p => !state || p.state === state).map(publicProject);
}

function getProjectById(id) {
  return publicProject(getProject(readStore(), id));
}

function saveResearch(id, { summary, sources = [], findings = [] } = {}) {
  const cleanSummary = requiredText(summary, 'Research summary');
  if (!Array.isArray(sources) || sources.length > 100) throw new Error('Sources must be an array with at most 100 entries.');
  if (!Array.isArray(findings) || findings.length > 100) throw new Error('Findings must be an array with at most 100 entries.');
  return mutateProject(id, p => {
    if (!['draft', 'researching', 'blueprint_ready'].includes(p.state)) throw new Error('Research can only be saved before approval/build.');
    p.research = {
      summary: cleanSummary,
      sources: sources.map(x => requiredText(String(x), 'Source', 2000)),
      findings: findings.map(x => requiredText(String(x), 'Finding', 2000)),
      completedAt: new Date().toISOString()
    };
    p.state = 'researching';
    p.revision += 1;
  });
}

function saveBlueprint(id, { overview, modules, language, interfaces, implementationPlan, testPlan, risks = [], openQuestions = [] } = {}) {
  const cleanOverview = requiredText(overview, 'Blueprint overview');
  const cleanLanguage = requiredText(language, 'Implementation language', 120);
  const cleanPlan = requiredText(implementationPlan, 'Implementation plan');
  const cleanTests = requiredText(testPlan, 'Test plan');
  for (const [label, value] of [['modules', modules], ['interfaces', interfaces], ['risks', risks], ['openQuestions', openQuestions]]) {
    if (!Array.isArray(value) || value.length > 100) throw new Error(label + ' must be an array with at most 100 entries.');
  }
  return mutateProject(id, p => {
    if (!p.research) throw new Error('Research must be recorded before a blueprint can be saved.');
    if (!['draft', 'researching', 'blueprint_ready'].includes(p.state)) throw new Error('Blueprint can only be revised before approval/build.');
    p.blueprint = {
      overview: cleanOverview, modules: modules.map(x => requiredText(String(x), 'Module', 2000)),
      language: cleanLanguage, interfaces: interfaces.map(x => requiredText(String(x), 'Interface', 2000)),
      implementationPlan: cleanPlan, testPlan: cleanTests,
      risks: risks.map(x => requiredText(String(x), 'Risk', 2000)),
      openQuestions: openQuestions.map(x => requiredText(String(x), 'Open question', 2000)),
      revision: p.revision + 1, createdAt: new Date().toISOString()
    };
    p.state = 'blueprint_ready';
    p.approval = null;
    p.build = null;
    p.tests = null;
    p.publishedCapability = null;
    p.revision += 1;
  });
}

function approveBlueprint(id, { approved, notes = '' } = {}) {
  if (approved !== true) throw new Error('Explicit approval must be true to start a build.');
  return mutateProject(id, p => {
    if (p.state !== 'blueprint_ready' || !p.blueprint || !p.research) throw new Error('A researched blueprint must exist before approval.');
    p.approval = { approved: true, notes: String(notes).slice(0, 4000), approvedAt: new Date().toISOString() };
    p.state = 'approved';
    p.revision += 1;
  });
}

function startBuild(id) {
  return mutateProject(id, p => {
    if (p.state !== 'approved' || p.approval?.approved !== true) throw new Error('The blueprint must be explicitly approved before building.');
    p.state = 'building';
    p.build = { startedAt: new Date().toISOString(), status: 'in_progress', summary: null, files: [] };
    p.tests = null;
    p.revision += 1;
  });
}

function recordBuildResult(id, { ok, summary, files = [] } = {}) {
  if (typeof ok !== 'boolean') throw new Error('Build result must include a boolean ok field.');
  const cleanSummary = requiredText(summary, 'Build summary');
  if (!Array.isArray(files) || files.length > 500) throw new Error('files must be an array with at most 500 entries.');
  return mutateProject(id, p => {
    if (p.state !== 'building') throw new Error('A build must be in progress before recording its result.');
    p.build = {
      ...(p.build || {}), completedAt: new Date().toISOString(),
      status: ok ? 'built' : 'failed', summary: cleanSummary,
      files: files.map(x => requiredText(String(x), 'File path', 500))
    };
    p.state = ok ? 'testing' : 'build_failed';
    p.revision += 1;
  });
}

function recordTestResult(id, { passed, summary, checks = [], runtime = 'not-configured' } = {}) {
  if (typeof passed !== 'boolean') throw new Error('Test result must include a boolean passed field.');
  const cleanSummary = requiredText(summary, 'Test summary');
  if (!Array.isArray(checks) || checks.length > 200) throw new Error('checks must be an array with at most 200 entries.');
  return mutateProject(id, p => {
    if (p.state !== 'testing') throw new Error('A successful build must be recorded before testing.');
    p.tests = {
      passed, summary: cleanSummary,
      checks: checks.map(x => requiredText(String(x), 'Test check', 2000)),
      runtime: String(runtime).slice(0, 120),
      completedAt: new Date().toISOString()
    };
    p.state = passed ? 'tested' : 'build_failed';
    p.revision += 1;
  });
}

function publishCapability(id, { endpoint, adapter, inputSchema, outputSchema, version = '1.0.0' } = {}) {
  const allowedAdapters = new Set(['openai-compatible', 'http-json', 'mcp-tool', 'local-process']);
  if (!allowedAdapters.has(adapter)) throw new Error('Unsupported capability adapter.');
  const cleanEndpoint = requiredText(endpoint, 'Runtime endpoint', 2000);
  if (adapter !== 'local-process') {
    let parsed;
    try { parsed = new URL(cleanEndpoint); } catch { throw new Error('Runtime endpoint must be a valid URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Runtime endpoint must use HTTP(S).');
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) {
      throw new Error('Remote runtime endpoints must use HTTPS.');
    }
  }
  if (!inputSchema || typeof inputSchema !== 'object' || !outputSchema || typeof outputSchema !== 'object') {
    throw new Error('Input and output schemas are required.');
  }
  return mutateProject(id, p => {
    if (p.state !== 'tested' || p.tests?.passed !== true || p.approval?.approved !== true) {
      throw new Error('Only an explicitly approved capability with passing tests can be published.');
    }
    p.publishedCapability = {
      id: p.id, name: p.name, description: p.goal, version: String(version).slice(0, 40),
      adapter, endpoint: cleanEndpoint, inputSchema, outputSchema,
      enabled: false, status: 'registered_disabled',
      publishedAt: new Date().toISOString()
    };
    p.state = 'published';
    p.revision += 1;
  });
}

function setCapabilityEnabled(id, enabled, { authorized = false, authorizationNote = '' } = {}) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean.');
  if (enabled && authorized !== true) throw new Error('Explicit authorization is required to enable a capability.');
  return mutateProject(id, p => {
    if (!p.publishedCapability) throw new Error('Capability must be published before it can be enabled.');
    p.publishedCapability.enabled = enabled;
    p.publishedCapability.status = enabled ? 'enabled' : 'disabled';
    if (enabled) p.publishedCapability.enabledAt = new Date().toISOString();
    p.publishedCapability.authorizationNote = String(authorizationNote).slice(0, 1000);
    p.state = enabled ? 'published' : 'disabled';
    p.revision += 1;
  });
}

module.exports = {
  REGISTRY_PATH, STATES, createProject, listProjects, getProjectById,
  saveResearch, saveBlueprint, approveBlueprint, startBuild,
  recordBuildResult, recordTestResult, publishCapability, setCapabilityEnabled
};
