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
console.log('Runtime npm dependencies: none.');
console.log('PDF extraction and video rendering require the optional system tools listed above.');
if(failed)process.exitCode=1;
