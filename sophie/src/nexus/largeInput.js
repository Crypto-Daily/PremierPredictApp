'use strict';
const{readStructuredFile,buildEvidence,limits}=require('./multimodal');
function inspectLargeInput(filePath,query,options={}){const r=readStructuredFile(filePath,options);if(!r.text)return{...r,evidence:[],status:r.complete===false?'partial':'unavailable'};const c=limits(options),evidence=buildEvidence(r.text,query,c);return{...r,status:'complete',evidence,evidenceCount:evidence.length,processedChunks:r.chunkCount,totalChunks:r.chunkCount,selection:query?'relevance-ranked':'sequential'}}
module.exports={inspectLargeInput};