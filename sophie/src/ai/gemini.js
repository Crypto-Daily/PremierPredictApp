require('dotenv').config();

let GoogleGenAI;

async function getAI() {
  if (!GoogleGenAI) {
    const sdk = await import('@google/genai');
    GoogleGenAI = sdk.GoogleGenAI;
  }

  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });
}

async function askSophie(userMessage, systemInstruction, options = {}) {
  const ai = await getAI();

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  const config = {
    systemInstruction
  };

  if (options.useWebSearch === true) {
    config.tools = [{ googleSearch: {} }];
  }

  console.log(
    `[GEMINI] Model: ${model} | Web Search: ${options.useWebSearch === true}`
  );

  const response = await ai.models.generateContent({
    model,
    contents: userMessage,
    config
  });

  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

  if (groundingMetadata) {
    console.log(
      '[GEMINI] Search queries used:',
      groundingMetadata.webSearchQueries
    );
    console.log(
      '[GEMINI] Sources:',
      groundingMetadata.groundingChunks?.map(c => c.web?.title)
    );
  } else {
    console.log('[GEMINI] No grounding metadata — search tool likely did not fire.');
  }

  return response.text;
}

module.exports = {
  askSophie
};
