'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophie-integration-'));
process.env.SOPHIE_FACTORY_REGISTRY = path.join(dir, 'registry.json');
process.env.SOPHIE_FACTORY_AUDIT = path.join(dir, 'audit.jsonl');
const factory = require('../src/factory/capabilityFactory');
const registry = require('../src/factory/capabilityRegistry');
try {
 const p=factory.createProject({name:'Integration test capability',goal:'Test registration discovery.'});
 factory.saveResearch(p.id,{summary:'Research',sources:['https://example.org'],findings:['Known endpoint contract']});
 factory.saveBlueprint(p.id,{overview:'Integration test',modules:['executor'],language:'Node.js',interfaces:['HTTP JSON'],implementationPlan:'Build test artifact',testPlan:'Verify registration',risks:[],openQuestions:[]});
 factory.approveBlueprint(p.id,{approved:true});
 factory.startBuild(p.id);
 factory.recordBuildResult(p.id,{ok:true,summary:'Build recorded',files:['index.js']});
 factory.recordTestResult(p.id,{passed:true,summary:'Tests passed',checks:['registration'],runtime:'node'});
 factory.publishCapability(p.id,{endpoint:'http://127.0.0.1:9999',adapter:'http-json',inputSchema:{type:'object'},outputSchema:{type:'object'}});
 assert.equal(registry.get(p.id).enabled,false);
 assert.throws(()=>registry.get(p.id,{requireEnabled:true}),/disabled/i);
 factory.setCapabilityEnabled(p.id,true,{authorized:true,authorizationNote:'Explicit test authorization'});
 assert.equal(registry.get(p.id,{requireEnabled:true}).id,p.id);
 console.log('Capability integration tests passed.');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
