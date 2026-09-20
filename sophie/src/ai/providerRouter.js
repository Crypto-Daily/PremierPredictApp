require('dotenv').config();

const https = require('https');

const PROVIDER_PRIORITY = ['Gemini', 'Groq', 'OpenRouter', 'NVIDIA'];

function postJson(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);

    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 30000
      },
      res => {
        let response = '';

        res.on('data', chunk => {
          response += chunk;
        });

        res.on('end', () => {
          let json;

          try {
            json = JSON.parse(response);
          } catch {
            json = { raw: response };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
            return;
          }

          const error = new Error(
            json?.error?.message ||
            json?.message ||
            `HTTP ${res.statusCode}`
          );

          error.status = res.statusCode;
          error.providerResponse = json;

          reject(error);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });

    req.on('error', reject);

    req.write(data);
    req.end();
  });
}

async function askGroq(userMessage, systemInstruction) {
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  console.log(`[GROQ] Model: ${model}`);

  const result = await postJson(
    'api.groq.com',
    '/openai/v1/chat/completions',
    { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 4096
    }
  );

  return result.choices?.[0]?.message?.content || '';
}

async function askOpenRouter(userMessage, systemInstruction) {
  const model = process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';

  console.log(`[OPENROUTER] Model: ${model}`);

  const result = await postJson(
    'openrouter.ai',
    '/api/v1/chat/completions',
    {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://sophie.local',
      'X-Title': 'Sophie AI'
    },
    {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 4096
    }
  );

  return result.choices?.[0]?.message?.content || '';
}

async function askNvidia(userMessage, systemInstruction) {
  const model = process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';

  console.log(`[NVIDIA] Model: ${model}`);

  const result = await postJson(
    'integrate.api.nvidia.com',
    '/v1/chat/completions',
    { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
    {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 4096
    }
  );

  return result.choices?.[0]?.message?.content || '';
}

function buildProviders(userMessage, systemInstruction, options) {
  const providers = [];

  if (process.env.GEMINI_API_KEY) {
    providers.push({
      name: 'Gemini',
      run: async () => {
        const { askSophie } = require('./gemini');
        return askSophie(userMessage, systemInstruction, {
          useWebSearch: options.useWebSearch === true
        });
      }
    });
  }

  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: 'Groq',
      run: () => askGroq(userMessage, systemInstruction)
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'OpenRouter',
      run: () => askOpenRouter(userMessage, systemInstruction)
    });
  }

  if (process.env.NVIDIA_API_KEY) {
    providers.push({
      name: 'NVIDIA',
      run: () => askNvidia(userMessage, systemInstruction)
    });
  }

  return providers;
}

// Sequential fallback: tries providers in order, returns the first success.
// Used for ordinary chat — cheapest option, no need to rank.
async function askWithFallback(userMessage, systemInstruction, options = {}) {
  const providers = buildProviders(userMessage, systemInstruction, options);
  const errors = [];

  for (const provider of providers) {
    try {
      console.log(`[AI ROUTER] Trying ${provider.name}`);

      const response = await provider.run();

      if (response && response.trim()) {
        console.log(`[AI ROUTER] ${provider.name} SUCCESS`);
        return { provider: provider.name, text: response };
      }

      throw new Error('Provider returned an empty response');

    } catch (error) {
      console.error(`[AI ROUTER] ${provider.name} FAILED:`, error.message);
      errors.push({ provider: provider.name, status: error.status, message: error.message });
    }
  }

  const error = new Error('All configured AI providers failed');
  error.providerErrors = errors;
  throw error;
}

// Parallel ranked query: queries every configured provider at once, then picks
// the response that best matches groundTruthTerms (verified facts from
// Wikidata/etc). If no ground truth is available, falls back to priority order.
// More expensive (queries every provider every time) — use only for intents
// where freshness/accuracy genuinely matters, e.g. WEB_RESEARCH.
async function askAllRanked(userMessage, systemInstruction, options = {}) {
  const providers = buildProviders(userMessage, systemInstruction, options);
  const groundTruthTerms = options.groundTruthTerms || [];

  console.log(`[AI ROUTER] Ranked mode: querying ${providers.length} providers in parallel`);

  const settled = await Promise.allSettled(
    providers.map(p => p.run().then(text => ({ name: p.name, text })))
  );

  const successes = [];

  settled.forEach((result, i) => {
    const name = providers[i].name;

    if (result.status === 'fulfilled' && result.value.text && result.value.text.trim()) {
      const score = groundTruthTerms.length > 0
        ? groundTruthTerms.filter(
            term => result.value.text.toLowerCase().includes(term.toLowerCase())
          ).length
        : 0;

      console.log(`[AI ROUTER] ${name} responded, score=${score}/${groundTruthTerms.length}`);
      successes.push({ provider: name, text: result.value.text, score });
    } else {
      const reason = result.status === 'rejected' ? result.reason.message : 'empty response';
      console.error(`[AI ROUTER] ${name} FAILED: ${reason}`);
    }
  });

  if (successes.length === 0) {
    throw new Error('All configured AI providers failed');
  }

  let winner;

  if (groundTruthTerms.length > 0) {
    const maxScore = Math.max(...successes.map(s => s.score));
    const topScored = successes.filter(s => s.score === maxScore);

    winner = topScored.sort(
      (a, b) => PROVIDER_PRIORITY.indexOf(a.provider) - PROVIDER_PRIORITY.indexOf(b.provider)
    )[0];

    console.log(`[AI ROUTER] Ranked winner: ${winner.provider} (score ${winner.score}/${groundTruthTerms.length})`);
  } else {
    winner = successes.sort(
      (a, b) => PROVIDER_PRIORITY.indexOf(a.provider) - PROVIDER_PRIORITY.indexOf(b.provider)
    )[0];

    console.log(`[AI ROUTER] No ground-truth terms — picked by priority: ${winner.provider}`);
  }

  return {
    provider: winner.provider,
    text: winner.text,
    allResponses: successes
  };
}

module.exports = {
  askWithFallback,
  askAllRanked
};
