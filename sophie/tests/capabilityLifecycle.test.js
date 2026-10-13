'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophie-lifecycle-'));
process.env.SOPHIE_FACTORY_REGISTRY = path.join(dir, 'registry.json');
process.env.SOPHIE_FACTORY_AUDIT = path.join(dir, 'audit.jsonl');
const factory = require('../src/factory/capabilityFactory');
const lifecycle = require('../src/factory/capabilityLifecycle');
try {
 const p = factory.createProject({name:'Approval lifecycle test',goal:'Test exact blueprint approval gate.'});
 factory.saveResearch(p.id,{summary:'Research',sources:['https://example.org'],findings:['Finding']});
 factory.saveBlueprint(p.id,{overview:'Test',modules:['one'],language:'Node.js',interfaces:['local'],implementationPlan:'Implement test',testPlan:'Run tests',risks:[],openQuestions:[]});
 assert.throws(()=>lifecycle.startBuild(p.id),/approv/i);
 assert.throws(()=>lifecycle.approve(p.id,{approved:false}),/approv/i);
 lifecycle.approve(p.id,{approved:true,notes:'Owner approved test blueprint'});
 assert.equal(lifecycle.startBuild(p.id).state,'building');
 factory.recordBuildResult(p.id,{ok:true,summary:'Built',files:['index.js']});
 factory.recordTestResult(p.id,{passed:true,summary:'Passed',checks:['unit'],runtime:'node'});
 const registered=lifecycle.publish(p.id,{endpoint:'http://127.0.0.1:9999',adapter:'http-json',inputSchema:{type:'object'},outputSchema:{type:'object'}});
 assert.equal(registered.publishedCapability.enabled,false);
 assert.throws(()=>lifecycle.setEnabled(p.id,true),/authorization/i);
 lifecycle.setEnabled(p.id,true,{authorized:true,authorizationNote:'Explicit test approval'});
 assert.equal(factory.getProjectById(p.id).publishedCapability.enabled,true);
 assert.ok(fs.readFileSync(process.env.SOPHIE_FACTORY_AUDIT,'utf8').includes('capability.enabled'));
 console.log('Capability lifecycle tests passed.');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
