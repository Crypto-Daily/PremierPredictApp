const assert = require('node:assert/strict');
const http = require('node:http');

async function main() {
  const received = [];
  let responseBody = {
    choices: [{ message: { role: 'assistant', content: 'META_AI_FALLBACK_OK' } }]
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  process.env.META_AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.META_AI_MODEL = 'test-meta-model';
  process.env.META_AI_ENABLED = 'true';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.NVIDIA_API_KEY;

  try {
    const { askWithFallback, askAllRanked } = require('../src/ai/providerRouter');
    const result = await askWithFallback('hello', 'be concise');

    assert.equal(result.provider, 'Meta AI');
    assert.equal(result.text, 'META_AI_FALLBACK_OK');
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].url, '/v1/chat/completions');
    assert.equal(received[0].body.model, 'test-meta-model');
    assert.deepEqual(received[0].body.messages, [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hello' }
    ]);

    const ranked = await askAllRanked('hello again', 'be concise');
    assert.equal(ranked.provider, 'Meta AI');
    assert.equal(ranked.text, 'META_AI_FALLBACK_OK');

    responseBody = { choices: [{ message: { content: '' } }] };
    await assert.rejects(
      askWithFallback('empty reply test', 'be concise'),
      error => error.message === 'All configured AI providers failed'
        && error.providerErrors?.some(item => item.provider === 'Meta AI'
          && item.message.includes('empty or unsupported response'))
    );

    console.log('Provider router Meta AI fallback tests passed.');
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    delete process.env.META_AI_BASE_URL;
    delete process.env.META_AI_MODEL;
    delete process.env.META_AI_ENABLED;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
