'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {status,safeBase,generateLocalImage}=require('../src/lib/localImageProvider');
test('local provider reports no paid external provider requirement',()=>{const s=status({ANIMATION_LOCAL_IMAGE_URL:'http://127.0.0.1:8188',ANIMATION_COMFY_WORKFLOW:'/tmp/workflow.json'});assert.equal(s.mode,'local-comfyui');assert.equal(s.configured,true);assert.equal(s.requiresExternalPaidProvider,false)});
test('local provider rejects remote plain HTTP and URL credentials',()=>{assert.throws(()=>safeBase({ANIMATION_LOCAL_IMAGE_URL:'http://10.0.0.2:8188'}),/HTTPS/);assert.throws(()=>safeBase({ANIMATION_LOCAL_IMAGE_URL:'http://user:pass@127.0.0.1:8188'}),/credentials/);assert.equal(safeBase({ANIMATION_LOCAL_IMAGE_URL:'http://127.0.0.1:8188'}),'http://127.0.0.1:8188')});
test('local provider clearly reports missing workflow before contacting server',async()=>{await assert.rejects(generateLocalImage('draw a fox',{env:{ANIMATION_LOCAL_IMAGE_URL:'http://127.0.0.1:8188'},fetch:()=>{throw Error('must not fetch')}}),/not configured yet/)});
test('local provider rejects empty prompt',async()=>{await assert.rejects(generateLocalImage(' ',{env:{ANIMATION_COMFY_WORKFLOW:'/missing.json'},fetch:()=>{throw Error('must not fetch')}}),/Enter a prompt/)});
