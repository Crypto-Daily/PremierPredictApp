'use strict';

const factory = require('../factory/capabilityFactory');

function factoryRoutes(app) {
  app.get('/api/factory/projects', (req, res) => {
    try { res.json({ projects: factory.listProjects({ state: req.query.state }) }); }
    catch (error) { res.status(500).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects', (req, res) => {
    try {
      const project = factory.createProject(req.body || {});
      res.status(201).json({ ok: true, project });
    } catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.get('/api/factory/projects/:id', (req, res) => {
    try { res.json({ project: factory.getProjectById(req.params.id) }); }
    catch (error) { res.status(404).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/research', (req, res) => {
    try { res.json({ ok: true, project: factory.saveResearch(req.params.id, req.body || {}) }); }
    catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/blueprint', (req, res) => {
    try { res.json({ ok: true, project: factory.saveBlueprint(req.params.id, req.body || {}) }); }
    catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/approve', (req, res) => {
    try {
      if (req.body?.approved !== true) return res.status(400).json({ error: 'Set approved: true to explicitly approve this blueprint.' });
      res.json({ ok: true, project: factory.approveBlueprint(req.params.id, { approved: true, notes: req.body?.notes }) });
    } catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/build/start', (req, res) => {
    try {
      res.json({
        ok: true,
        project: factory.startBuild(req.params.id),
        notice: 'Lifecycle state only. No code was executed. A sandboxed build runner is not yet integrated.'
      });
    } catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/build/result', (req, res) => {
    try { res.json({ ok: true, project: factory.recordBuildResult(req.params.id, req.body || {}) }); }
    catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/tests/result', (req, res) => {
    try { res.json({ ok: true, project: factory.recordTestResult(req.params.id, req.body || {}) }); }
    catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/publish', (req, res) => {
    try { res.json({ ok: true, project: factory.publishCapability(req.params.id, req.body || {}) }); }
    catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/enable', (req, res) => {
    try {
      if (req.body?.authorized !== true) return res.status(400).json({ error: 'Explicit authorized: true is required to enable a capability.' });
      res.json({ ok: true, project: factory.setCapabilityEnabled(req.params.id, true, { authorized: true, authorizationNote: req.body?.authorizationNote }) });
    } catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });

  app.post('/api/factory/projects/:id/disable', (req, res) => {
    try { res.json({ ok: true, project: factory.setCapabilityEnabled(req.params.id, false) }); }
    catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 500) }); }
  });
}

module.exports = { factoryRoutes };
