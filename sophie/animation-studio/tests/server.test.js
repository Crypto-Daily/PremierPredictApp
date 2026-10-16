'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
process.env.ANIMATION_STUDIO_DATA_DIR=path.join(os.tmpdir(),'sophie-animation-test-data-'+process.pid);
const {server}=require('../src/index.js');
let base;
test('HTTP service health and project APIs work',async t=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(process.env.ANIMATION_STUDIO_DATA_DIR,{recursive:true,force:true});});
  const health=await fetch(base+'/api/health').then(r=>r.json());
  assert.equal(health.ok,true);
  const created=await fetch(base+'/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'API test'})});
  assert.equal(created.status,201);
  const p=(await created.json()).project;
  assert.equal(p.title,'API test');
  const saved=await fetch(base+'/api/projects/'+p.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...p,title:'Saved test'})});
  assert.equal(saved.status,200);
  const loaded=await fetch(base+'/api/projects/'+p.id).then(r=>r.json());
  assert.equal(loaded.project.title,'Saved test');
  const list=await fetch(base+'/api/projects').then(r=>r.json());
  assert.ok(list.projects.some(x=>x.id===p.id));
});
test('story endpoint returns a reviewable heuristic plan',async()=>{
  const response=await fetch(base+'/api/story/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'A child enters a forest.\n\nA bird flies away.'})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.plan.mode,'heuristic-draft');
  assert.equal(result.plan.sceneCount,2);
});
test('unknown API paths return JSON 404',async()=>{
  const response=await fetch(base+'/api/not-a-route');
  assert.equal(response.status,404);
  assert.equal((await response.json()).error,'Route not found.');
});
