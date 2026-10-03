'use strict';
const assert = require('node:assert/strict');
const { classifyFile } = require('../src/nexus/multimodal');
assert.equal(classifyFile('report.pdf'), 'document');
assert.equal(classifyFile('data.xlsx'), 'document');
assert.equal(classifyFile('photo.png'), 'image');
assert.equal(classifyFile('voice.mp3'), 'audio');
console.log('NEXUS multimodal tests passed.');
