import { fail } from '../errors.mjs';

export async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) fail(415, 'Use application/json');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32768) fail(413, 'Request too large');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { fail(400, 'Invalid JSON'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Invalid request');
  return body;
}
