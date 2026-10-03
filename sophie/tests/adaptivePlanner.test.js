'use strict';
const assert = require('node:assert/strict');
const { scoreObservation, adaptPlan } = require('../src/nexus/adaptivePlanner');
const task = { id:'t1', objective:'research and create a report', intent:'WEB_RESEARCH', mode:'GPT',
  workflow:{ stages:[{id:'understand'},{id:'verify'},{id:'deliver'}], sourcePlan:{steps:[]} } };
assert.equal(scoreObservation({ok:false,error:'timeout'}),'retry');
assert.equal(scoreObservation({verified:false}),'replan');
assert.equal(scoreObservation({message:'insufficient evidence'}),'retrieve_more');
assert.equal(adaptPlan({task,observation:{verified:false}}).action,'replan');
assert.equal(adaptPlan({task,observation:{message:'insufficient evidence'}}).action,'retrieve_more');
assert.equal(adaptPlan({task,error:{status:401}}).action,'approval');
console.log('NEXUS adaptive planner tests passed.');
