'use strict';

// Deliberately limited workflow tool: it can draft/research/blueprint projects and
// record build evidence, but it cannot grant approval, execute code, publish, or
// enable capabilities. Those actions require a separate trusted control surface.
const factory = require('../factory/capabilityFactory');
const { research } = require('../nexus/researchEngine');
const { buildAndVerify } = require('../factory/buildPipeline');

const ACTIONS = new Set([
  'create_project', 'list_projects', 'get_project', 'research_project',
  'save_research', 'save_blueprint', 'start_build', 'build_and_verify',
  'record_build_result', 'record_test_result'
]);

module.exports = {
  name: 'capability_factory',
  description: 'Manage Sophie capability-factory projects. This tool never executes generated code. Explicit user approval and a sandboxed runner are required before any build; publishing and enabling are intentionally unavailable here.',
  capabilities: ['project_planning', 'research_tracking', 'blueprint', 'build_lifecycle'],
  risk: 'high',
  async execute(input = {}) {
    const action = String(input.action || '');
    if (!ACTIONS.has(action)) {
      throw new Error('Unsupported factory action. Allowed actions: ' + [...ACTIONS].join(', ') + '. Approval, code execution, publishing, and enabling are not exposed through this tool.');
    }
    switch (action) {
      case 'create_project':
        return factory.createProject({
          name: input.name, goal: input.goal,
          requirements: input.requirements, constraints: input.constraints,
          createdBy: 'sophie-hermes'
        });
      case 'list_projects':
        return factory.listProjects({ state: input.state });
      case 'get_project':
        return factory.getProjectById(input.projectId);
      case 'research_project': {
        const project = factory.getProjectById(input.projectId);
        const query = String(input.query || (project.name + ' ' + project.goal)).slice(0, 4000);
        const results = await research(query, { limit: Math.max(1, Math.min(8, Number(input.limit) || 6)) });
        const usable = results.filter(item => item && item.url && /^https?:\/\//i.test(item.url));
        if (!usable.length) throw new Error('Research returned no usable source URLs; no research record was saved.');
        const saved = factory.saveResearch(input.projectId, {
          summary: 'Research query: ' + query + '\nCollected ' + usable.length + ' web results. Each result is untrusted external evidence and must be verified before implementation.',
          sources: usable.map(item => item.url),
          findings: usable.map(item => '[' + (item.title || 'Untitled source') + '] ' + String(item.content || '').slice(0, 1800))
        });
        return { project: saved, query, results: usable };
      }
      case 'save_research':
        return factory.saveResearch(input.projectId, {
          summary: input.summary, sources: input.sources, findings: input.findings
        });
      case 'save_blueprint':
        return factory.saveBlueprint(input.projectId, {
          overview: input.overview, modules: input.modules, language: input.language,
          interfaces: input.interfaces, implementationPlan: input.implementationPlan,
          testPlan: input.testPlan, risks: input.risks, openQuestions: input.openQuestions
        });
      case 'start_build':
        // This succeeds only after approval was recorded through a trusted API.
        return factory.startBuild(input.projectId);
      case 'build_and_verify':
        // Source files must be supplied by Hermes after owner approval; the runner
        // executes checks only inside the isolated sandbox and never deploys them.
        return buildAndVerify(input.projectId, input.files, { timeoutMs: input.timeoutMs });
      case 'record_build_result':
        return factory.recordBuildResult(input.projectId, {
          ok: input.ok, summary: input.summary, files: input.files
        });
      case 'record_test_result':
        return factory.recordTestResult(input.projectId, {
          passed: input.passed, summary: input.summary, checks: input.checks,
          runtime: input.runtime
        });
      default:
        throw new Error('Unsupported factory action.');
    }
  }
};
