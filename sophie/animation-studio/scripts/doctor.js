'use strict';
const {spawnSync}=require('node:child_process');
const major=Number(process.versions.node.split('.')[0]);
let failed=false;
console.log('Sophie Animation Studio environment check');
console.log('Node.js: '+process.version+(major>=20?' (OK)':' (requires Node.js 20+)'));
if(major<20)failed=true;
function check(label,command,args){const r=spawnSync(command,args,{encoding:'utf8',timeout:5000});if(r.error&&r.error.code==='ENOENT'){console.log(label+': not found (optional)');return;}if(r.error){console.log(label+': check failed ('+r.error.message+')');return;}const line=(r.stdout||r.stderr||'').trim().split('\n')[0];console.log(label+': '+(r.status===0?'available':'found, but version check returned '+r.status)+(line?' — '+line:''));}
check('Poppler pdftotext','pdftotext',['-v']);
check('FFmpeg','ffmpeg',['-version']);
const comfy=process.env.ANIMATION_LOCAL_IMAGE_URL||'http://127.0.0.1:8188';
try { const u=new URL(comfy); console.log('ComfyUI endpoint: '+u.toString()+' (configuration only; service reachability is not tested)'); } catch { console.log('ComfyUI endpoint: invalid URL'); failed=true; }
if(process.env.ANIMATION_COMFY_WORKFLOW) console.log('ComfyUI workflow: configured at '+process.env.ANIMATION_COMFY_WORKFLOW); else console.log('ComfyUI workflow: not configured (local AI generation remains disabled)');
console.log('Runtime npm dependencies: none.');
console.log('PDF extraction and video rendering require the optional system tools listed above.');
if(failed)process.exitCode=1;
