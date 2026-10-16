import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { fail } from '../errors.mjs';
import { requiredText, integer } from '../validation.mjs';
import { requireRole } from '../security.mjs';

/** Secrets are encrypted at rest; the wrapping key is supplied by the deployment. */
export function readerService(repository, encryptionKey) {
  if (encryptionKey && !/^[a-f0-9]{64}$/i.test(encryptionKey))
    throw new Error('DEVICE_ENCRYPTION_KEY must contain 64 hex characters');
  const key = encryptionKey ? Buffer.from(encryptionKey, 'hex') : null;
  const requireKey = () => {
    if (!key) fail(503, 'Configure DEVICE_ENCRYPTION_KEY before provisioning readers');
  };
  const encrypt = (secret) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('hex')).join('.');
  };
  const decrypt = (value) => {
    const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'hex'));
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
  };
  const generateSecret = () => randomBytes(32).toString('hex');
  return {
    list(user) {
      requireRole(user, ['Admin']);
      return {
        configured: Boolean(key),
        readers: repository.all(
          'SELECT id, name, location, active, created, last_seen FROM readers ORDER BY id',
        ),
        tags: repository.all('SELECT * FROM trolley_tags ORDER BY tag'),
        events: repository.all(
          'SELECT id, reader, event_id, tag, trolley, observed_at, received_at, location FROM reader_events ORDER BY id DESC LIMIT 50',
        ),
      };
    },
    create(user, input) {
      requireRole(user, ['Admin']);
      requireKey();
      const id = requiredText(input.id, 'reader ID', 40);
      const name = requiredText(input.name, 'reader name');
      const location = requiredText(input.location, 'reader location');
      if (!repository.get('SELECT id FROM locations WHERE id = ?', location))
        fail(400, 'Unknown reader location');
      const secret = generateSecret();
      repository.transaction(() => {
        repository.run(
          'INSERT INTO readers(id, name, location, encrypted_secret, created_by, created) VALUES (?, ?, ?, ?, ?, ?)',
          id,
          name,
          location,
          encrypt(secret),
          user.id,
          Date.now(),
        );
        repository.audit(user, 'Reader provisioned', id, { location });
      });
      return { id, secret }; // Returned once; never included in list responses or logs.
    },
    rotate(user, input) {
      requireRole(user, ['Admin']);
      requireKey();
      const id = requiredText(input.id, 'reader ID');
      if (!repository.get('SELECT id FROM readers WHERE id = ? AND active = 1', id))
        fail(404, 'Active reader not found');
      const secret = generateSecret();
      repository.transaction(() => {
        repository.run('UPDATE readers SET encrypted_secret = ? WHERE id = ?', encrypt(secret), id);
        repository.audit(user, 'Reader credential rotated', id, {});
      });
      return { id, secret };
    },
    deactivate(user, input) {
      requireRole(user, ['Admin']);
      const id = requiredText(input.id, 'reader ID');
      if (!repository.get('SELECT id FROM readers WHERE id = ?', id)) fail(404, 'Reader not found');
      repository.transaction(() => {
        repository.run('UPDATE readers SET active = 0 WHERE id = ?', id);
        repository.audit(user, 'Reader deactivated', id, {});
      });
    },
    assignTag(user, input) {
      requireRole(user, ['Admin']);
      const tag = requiredText(input.tag, 'RFID / QR tag', 128);
      const trolley = requiredText(input.trolley, 'trolley');
      if (!repository.get('SELECT id FROM trolleys WHERE id = ?', trolley))
        fail(400, 'Unknown trolley');
      repository.transaction(() => {
        const collision = repository.get(
          'SELECT id FROM trolleys WHERE id <> ? AND (lower(id) = lower(?) OR lower(qr_value) = lower(?) OR lower(rfid) = lower(?))',
          trolley,
          tag,
          tag,
          tag,
        );
        if (collision) fail(409, 'Tag matches another trolley identity');
        const previous = repository.get(
          'SELECT trolley FROM trolley_tags WHERE tag = ? COLLATE NOCASE',
          tag,
        );
        if (previous && previous.trolley !== trolley)
          fail(409, 'Tag is already assigned to another trolley');
        repository.run(
          'INSERT INTO trolley_tags VALUES (?, ?) ON CONFLICT(tag) DO NOTHING',
          tag,
          trolley,
        );
        repository.audit(user, 'Tag assigned', trolley, { tag });
      });
    },
    ingest(headers, rawBody, input) {
      requireKey();
      const id = requiredText(headers['x-device-id'], 'reader ID', 40);
      const timestamp = Number(headers['x-device-timestamp']);
      const signature = headers['x-device-signature'];
      const reader = repository.get('SELECT * FROM readers WHERE id = ? AND active = 1', id);
      if (
        !reader ||
        !Number.isSafeInteger(timestamp) ||
        Math.abs(Date.now() - timestamp) > 300000 ||
        typeof signature !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(signature)
      )
        fail(401, 'Invalid reader signature or timestamp');
      const expected = createHmac('sha256', decrypt(reader.encrypted_secret))
        .update(`${timestamp}.${rawBody}`)
        .digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
        fail(401, 'Invalid reader signature or timestamp');
      const eventId = requiredText(input.eventId, 'event ID', 100);
      const tag = requiredText(input.tag, 'tag', 128);
      const observedAt = integer(input.observedAt, 'observation timestamp');
      const now = Date.now();
      const payloadHash = createHash('sha256')
        .update(JSON.stringify({ eventId, tag, observedAt }))
        .digest('hex');
      return repository.transaction(() => {
        const previous = repository.get(
          'SELECT * FROM reader_events WHERE reader = ? AND event_id = ?',
          id,
          eventId,
        );
        if (previous) {
          if (previous.payload_hash !== payloadHash)
            fail(409, 'Event ID already used for another observation');
          return { id: previous.id, trolley: previous.trolley, duplicate: true };
        }
        if (observedAt > now + 300000 || observedAt < now - 7 * 86400000)
          fail(400, 'Observation must be within the last seven days');
        const mapping = repository.get(
          'SELECT trolley FROM trolley_tags WHERE tag = ? COLLATE NOCASE',
          tag,
        );
        const trolley =
          mapping?.trolley ||
          repository.get(
            'SELECT id FROM trolleys WHERE id = ? OR qr_value = ? OR rfid = ?',
            tag,
            tag,
            tag,
          )?.id ||
          null;
        const inserted = repository.run(
          `INSERT INTO reader_events
          (reader, event_id, tag, trolley, observed_at, received_at, location, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          eventId,
          tag,
          trolley,
          observedAt,
          now,
          reader.location,
          payloadHash,
        );
        repository.run('UPDATE readers SET last_seen = ? WHERE id = ?', now, id);
        // Observations never silently change trolley location or confirm receipt.
        return { id: Number(inserted.lastInsertRowid), trolley, duplicate: false };
      });
    },
  };
}
