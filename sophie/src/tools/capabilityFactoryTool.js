'use strict';

// Deliberately limited workflow tool: it can draft/research/blueprint projects and
// record build evidence, but it cannot grant approval, execute code, publish, or
// enable capabilities. Those actions require a separate trusted control surface.
const factory = require('../factory/capabilityFactory');

const ACTIONS = new Set([
  'create_project', 'list_projects', 'get_project',
  'save_research', 'save_blueprint', 'start_build',
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
          createdBy: 'hermes-tool'
        });
      case 'list_projects':
        return factory.listProjects({ state: input.state });
      case 'get_project':
        return factory.getProjectById(input.projectId);
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
