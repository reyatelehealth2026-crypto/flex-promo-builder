// Pure ES module for building image-generation requests and parsing responses.
// Providers: OpenAI (gpt-image-1) and Google Gemini (gemini-2.5-flash-image).
// No DOM, no Electron, no external imports — runnable under plain Node.

export const IMAGE_PROVIDERS = ['openai', 'gemini'];

const OPENAI_URL = 'https://api.openai.com/v1/images/generations';
const GEMINI_MODEL = 'gemini-2.5-flash-image';
// Image-output models + responseModalities only exist on v1beta — the v1
// endpoint rejects the request with 400 (unknown field / model not found).
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Build an HTTP request descriptor for the given image provider.
 * @param {'openai'|'gemini'} provider
 * @param {string} key API key / token
 * @param {string} prompt text prompt
 * @param {{size?:string, refImage?:{mime?:string, base64:string}}} [opts]
 *   refImage — optional reference image for image-to-image (Gemini only).
 * @returns {{url:string, method:'POST', headers:Object, body:string}}
 */
export function buildImageRequest(provider, key, prompt, opts = {}) {
  if (!IMAGE_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown image provider: ${provider}`);
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Missing API key');
  }
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('Missing prompt');
  }

  if (provider === 'openai') {
    const body = {
      model: 'gpt-image-1',
      prompt,
      size: opts.size || '1024x1024',
      n: 1,
    };
    return {
      url: OPENAI_URL,
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    };
  }

  // provider === 'gemini'
  // Image-to-image: a reference image is sent as an inlineData part alongside
  // the text. Gemini reads the image then applies the prompt to it.
  const parts = [];
  if (opts.refImage && opts.refImage.base64) {
    parts.push({
      inlineData: {
        mimeType: opts.refImage.mime || 'image/png',
        data: opts.refImage.base64,
      },
    });
  }
  parts.push({ text: prompt });
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };
  return {
    url: `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`,
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Parse a provider response JSON into a PNG data URL.
 * Throws Error with the provider message on an error/refusal payload.
 * @param {'openai'|'gemini'} provider
 * @param {Object} json parsed response object
 * @returns {string} 'data:image/png;base64,<...>'
 */
export function parseImageResponse(provider, json) {
  if (!IMAGE_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown image provider: ${provider}`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error('Empty image response');
  }

  // Both providers surface failures under an `error` object.
  if (json.error) {
    const message =
      (typeof json.error === 'object' && (json.error.message || json.error.status)) ||
      (typeof json.error === 'string' && json.error) ||
      'Image generation failed';
    throw new Error(message);
  }

  if (provider === 'openai') {
    const item = json.data && json.data[0];
    const b64 = item && item.b64_json;
    if (!b64) {
      throw new Error('OpenAI response missing image data (data[0].b64_json)');
    }
    return `data:image/png;base64,${b64}`;
  }

  // provider === 'gemini'
  const candidate = json.candidates && json.candidates[0];
  if (!candidate) {
    throw new Error('Gemini response missing candidates');
  }
  // A refusal / safety block may set finishReason without inline image data.
  const parts =
    (candidate.content && candidate.content.parts) || [];
  let inline = null;
  for (const part of parts) {
    if (part && part.inlineData && part.inlineData.data) {
      inline = part.inlineData;
      break;
    }
  }
  if (!inline) {
    const reason =
      candidate.finishReason ||
      (candidate.content &&
        candidate.content.parts &&
        candidate.content.parts.find((p) => p && p.text) &&
        candidate.content.parts.find((p) => p && p.text).text) ||
      'Gemini response missing inline image data';
    throw new Error(String(reason));
  }
  const mime = inline.mimeType || 'image/png';
  return `data:${mime};base64,${inline.data}`;
}
