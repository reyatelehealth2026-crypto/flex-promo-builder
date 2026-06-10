// Pure ES module for uploading an image to a public host and getting back an
// HTTPS URL — the bridge between "studio makes an image" and "LINE Flex needs a
// public hero URL". No DOM, no Electron, no imports: runnable under plain Node.
//
// Providers:
//   imgbb      — one free API key. body: key=...&image=<base64>
//   cloudinary — unsigned upload preset (no secret in client). body:
//                file=data:<mime>;base64,<base64>&upload_preset=<preset>
//
// Both use application/x-www-form-urlencoded so the request body is a plain
// string and rides the existing proxyFetch / service-worker pipeline.

export const HOST_PROVIDERS = ['imgbb', 'cloudinary'];

const IMGBB_URL = 'https://api.imgbb.com/1/upload';

// Strip a data: URL prefix, leaving bare base64.
function bareBase64(input) {
  return String(input || '').replace(/^data:[^;]+;base64,/, '');
}

/**
 * Build an HTTP request descriptor for uploading an image.
 * @param {'imgbb'|'cloudinary'} provider
 * @param {Object} creds  imgbb: { key } · cloudinary: { cloud, preset }
 * @param {string} image  base64 (with or without data: prefix)
 * @param {{ name?:string, mime?:string }} [opts]
 * @returns {{url:string, method:'POST', headers:Object, body:string}}
 */
export function buildUploadRequest(provider, creds = {}, image, opts = {}) {
  if (!HOST_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown image host: ${provider}`);
  }
  const b64 = bareBase64(image);
  if (!b64) throw new Error('Missing image data');

  if (provider === 'imgbb') {
    if (!creds.key) throw new Error('Missing imgbb API key');
    const parts = [
      `key=${encodeURIComponent(creds.key)}`,
      `image=${encodeURIComponent(b64)}`,
    ];
    if (opts.name) parts.push(`name=${encodeURIComponent(opts.name)}`);
    return {
      url: IMGBB_URL,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: parts.join('&'),
    };
  }

  // provider === 'cloudinary'
  if (!creds.cloud || !creds.preset) {
    throw new Error('Missing Cloudinary cloud name or upload preset');
  }
  const mime = opts.mime || 'image/png';
  const dataUrl = `data:${mime};base64,${b64}`;
  const body = [
    `file=${encodeURIComponent(dataUrl)}`,
    `upload_preset=${encodeURIComponent(creds.preset)}`,
  ].join('&');
  return {
    url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(creds.cloud)}/image/upload`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  };
}

/**
 * Parse a host response JSON into a public HTTPS image URL.
 * Throws Error with the provider message on failure.
 * @param {'imgbb'|'cloudinary'} provider
 * @param {Object} json
 * @returns {string} https URL
 */
export function parseUploadResponse(provider, json) {
  if (!json || typeof json !== 'object') throw new Error('Empty upload response');

  if (provider === 'imgbb') {
    if (json.success && json.data && json.data.url) {
      return json.data.display_url || json.data.url;
    }
    const msg = (json.error && (json.error.message || json.error)) || 'imgbb upload failed';
    throw new Error(String(msg));
  }

  // cloudinary
  if (json.secure_url) return json.secure_url;
  const msg = (json.error && (json.error.message || json.error)) || 'Cloudinary upload failed';
  throw new Error(String(msg));
}
