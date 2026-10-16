import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { prepareLocal } from '../scripts/start-local.mjs';

test('local setup creates unique private credentials without installing dependencies', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trolley-local-new-'));
  const otherDirectory = mkdtempSync(join(tmpdir(), 'trolley-local-other-'));
  try {
    const prepared = prepareLocal({ root: directory, environment: {}, install: false });
    const other = prepareLocal({ root: otherDirectory, environment: {}, install: false });
    const filename = join(directory, '.env');
    const saved = parseEnv(readFileSync(filename, 'utf8'));
    assert.equal(prepared.created, true);
    assert.equal(prepared.root, directory);
    assert.deepEqual(readdirSync(directory), ['.env']);
    assert.match(saved.ADMIN_PASSWORD, /^[a-f0-9]{48}$/);
    assert.match(saved.DEVICE_ENCRYPTION_KEY, /^[a-f0-9]{64}$/);
    assert.ok(prepared.environment.ADMIN_PASSWORD === saved.ADMIN_PASSWORD);
    assert.ok(prepared.environment.DEVICE_ENCRYPTION_KEY === saved.DEVICE_ENCRYPTION_KEY);
    assert.ok(prepared.environment.ADMIN_PASSWORD !== other.environment.ADMIN_PASSWORD);
    assert.ok(
      prepared.environment.DEVICE_ENCRYPTION_KEY !== other.environment.DEVICE_ENCRYPTION_KEY,
    );
    assert.equal(prepared.environment.HOST, '127.0.0.1');
    assert.equal(prepared.environment.PORT, '8080');
    if (process.platform !== 'win32') assert.equal(statSync(filename).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(otherDirectory, { recursive: true, force: true });
  }
});

test('local setup preserves existing files and respects environment overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trolley-local-existing-'));
  const settings =
    '# Existing local settings\nADMIN_PASSWORD="existing-test-password"\nPORT=8087\nDEVICE_ENCRYPTION_KEY=\n';
  try {
    const filename = join(directory, '.env');
    writeFileSync(filename, settings);
    writeFileSync(join(directory, 'local-notes.txt'), 'Keep these user notes.');
    const prepared = prepareLocal({
      root: directory,
      environment: { PORT: '8097', LOCAL_LABEL: 'test workspace' },
      install: false,
    });
    assert.equal(prepared.created, false);
    assert.ok(prepared.environment.ADMIN_PASSWORD === 'existing-test-password');
    assert.equal(prepared.environment.PORT, '8097');
    assert.equal(prepared.environment.LOCAL_LABEL, 'test workspace');
    assert.equal(readFileSync(filename, 'utf8'), settings);
    assert.equal(
      readFileSync(join(directory, 'local-notes.txt'), 'utf8'),
      'Keep these user notes.',
    );
    assert.deepEqual(readdirSync(directory).sort(), ['.env', 'local-notes.txt']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local setup refuses invalid saved credentials without modifying files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trolley-local-invalid-'));
  try {
    const filename = join(directory, '.env');
    for (const password of ['', 'too-short', 'x'.repeat(257)]) {
      const settings = `# Preserve this configuration\nADMIN_PASSWORD=${password}\nPORT=8088\n`;
      writeFileSync(filename, settings);
      assert.throws(
        () => prepareLocal({ root: directory, environment: {}, install: false }),
        /ADMIN_PASSWORD.*12–256/,
      );
      assert.ok(readFileSync(filename, 'utf8') === settings);
      assert.deepEqual(readdirSync(directory), ['.env']);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
