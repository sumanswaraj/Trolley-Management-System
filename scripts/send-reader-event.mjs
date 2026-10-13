import { createHmac, randomUUID } from 'node:crypto';

// Reader vendors plug their parser into this HTTP contract; this is a test adapter.
const [tag, observedAtInput, eventIdInput] = process.argv.slice(2);
const { READER_ID, READER_SECRET, TROLLEY_SERVER } = process.env;
if (!tag || !READER_ID || !READER_SECRET || !TROLLEY_SERVER) {
  throw new Error(
    'Set READER_ID, READER_SECRET, TROLLEY_SERVER and pass a tag. Optional arguments: observedAtMs eventId',
  );
}
const url = new URL('/api/reader-events', TROLLEY_SERVER);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Use HTTPS for reader events outside localhost.');
}
const body = JSON.stringify({
  eventId: eventIdInput || randomUUID(),
  tag,
  observedAt: observedAtInput ? Number(observedAtInput) : Date.now(),
});
const timestamp = String(Date.now());
const signature = createHmac('sha256', READER_SECRET).update(`${timestamp}.${body}`).digest('hex');
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Device-Id': READER_ID,
    'X-Device-Timestamp': timestamp,
    'X-Device-Signature': signature,
  },
  body,
  signal: AbortSignal.timeout(10000),
});
const result = await response.json();
if (!response.ok) throw new Error(`${response.status}: ${result.error}`);
console.log(JSON.stringify(result));
