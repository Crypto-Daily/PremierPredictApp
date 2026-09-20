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

function isTemporaryError(error) {
  const status = error?.status;
  const message = error?.message || '';

  return (
    status === 503 ||
    status === 429 ||
    message.includes('503') ||
    message.includes('UNAVAILABLE') ||
    message.includes('high demand') ||
    message.includes('RESOURCE_EXHAUSTED')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateVision(ai, model, imageBase64, mimeType, question) {
  return ai.models.generateContent({
    model,

    contents: [
      {
        inlineData: {
          mimeType,
          data: imageBase64
        }
      },
      {
        text: question
      }
    ],

    config: {
      systemInstruction: `
You are Sophie, a personal AI assistant with vision.

Your job is to analyze images provided by the user and explain
what you can actually observe.

Rules:
- Be accurate and concise.
- Do not pretend to see something that is unclear.
- If something cannot be determined from the image, say so.
- Describe objects, scenes, text, colors, layouts and other visible
  information when relevant.
- Do not identify real people by name or attempt to determine their
  identity.
- Remember that you only see the image supplied with the request.
`
    }
  });
}

async function analyzeImage(
  imageBase64,
  mimeType,
  question = 'Describe what you can see in this image clearly.'
) {
  if (!imageBase64) {
    throw new Error('Image data is required');
  }

  if (!mimeType || !mimeType.startsWith('image/')) {
    throw new Error('A valid image MIME type is required');
  }

  const ai = await getAI();

  const primaryModel =
    process.env.GEMINI_MODEL || 'gemini-3.6-flash';

  const fallbackModel = 'gemini-3.5-flash-lite';

  const models = [primaryModel];

  if (fallbackModel !== primaryModel) {
    models.push(fallbackModel);
  }

  let lastError;

  for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(
          `Sophie vision: ${model}, attempt ${attempt}`
        );

        const response = await generateVision(
          ai,
          model,
          imageBase64,
          mimeType,
          question
        );

        console.log(
          `Sophie vision successful using ${model}`
        );

        return response.text;

      } catch (error) {
        lastError = error;

        console.error(
          `Vision attempt failed: ${model}, attempt ${attempt}`,
          error.message
        );

        if (!isTemporaryError(error)) {
          throw error;
        }

        if (attempt < 3) {
          const delay = attempt * 1500;

          console.log(
            `Temporary Gemini error. Retrying in ${delay}ms...`
          );

          await sleep(delay);
        }
      }
    }

    console.log(
      `Primary vision model unavailable. Trying fallback: ${fallbackModel}`
    );
  }

  throw lastError || new Error(
    'Gemini vision is temporarily unavailable'
  );
}

module.exports = {
  analyzeImage
};
