import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.mjs';
import { verifyPassword } from '../src/security.mjs';
import { prepareDemoDatabase, seedDemo } from '../scripts/demo.mjs';

test('sample seeding uses valid service workflows and preserves existing records on repeat', () => {
  const repository = openDatabase(':memory:');
  const password = 'sample-only-test-password';
  try {
    const result = seedDemo(repository, password);
    assert.deepEqual(result, {
      seeded: true,
      trolleys: 128,
      locations: 11,
      products: 10,
      users: 6,
    });
    assert.deepEqual(repository.all('PRAGMA foreign_key_check'), []);
    assert.equal(
      repository.get("SELECT COUNT(*) AS count FROM trolleys WHERE id NOT LIKE 'DEMO-%'").count,
      0,
    );
    for (const user of repository.all('SELECT * FROM users'))
      assert.ok(verifyPassword(password, user));
    assert.equal(repository.get('SELECT COUNT(DISTINCT role) AS count FROM users').count, 6);
    assert.ok(repository.get("SELECT id FROM movements WHERE state = 'Received'"));
    assert.ok(repository.get("SELECT id FROM movements WHERE state = 'Pending'"));
    assert.ok(repository.get('SELECT movement FROM correction_requests'));
    assert.ok(repository.get("SELECT id FROM audit WHERE action = 'Movement requested'"));
    const snapshot = ['users', 'trolleys', 'movements', 'alerts', 'audit'].map(
      (table) => repository.get(`SELECT COUNT(*) AS count FROM ${table}`).count,
    );
    assert.equal(seedDemo(repository, password).seeded, false);
    assert.deepEqual(
      ['users', 'trolleys', 'movements', 'alerts', 'audit'].map(
        (table) => repository.get(`SELECT COUNT(*) AS count FROM ${table}`).count,
      ),
      snapshot,
    );
  } finally {
    repository.close();
  }
});

test('demo reset archives only sample files and leaves the normal database untouched', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trolley-demo-reset-'));
  const normal = join(directory, 'trolley.sqlite');
  const demo = join(directory, 'demo.sqlite');
  try {
    writeFileSync(normal, 'normal application data');
    writeFileSync(demo, 'isolated sample data');
    writeFileSync(demo + '-wal', 'sample WAL');
    const preserved = prepareDemoDatabase(directory);
    assert.equal(preserved.archived, null);
    assert.equal(readFileSync(demo, 'utf8'), 'isolated sample data');
    assert.throws(() => prepareDemoDatabase(directory, { reset: true }), /already running/);
    preserved.release();
    const reset = prepareDemoDatabase(directory, { reset: true });
    try {
      assert.equal(reset.filename, demo);
      assert.equal(
        readFileSync(join(reset.archived, 'demo.sqlite'), 'utf8'),
        'isolated sample data',
      );
      assert.equal(readFileSync(join(reset.archived, 'demo.sqlite-wal'), 'utf8'), 'sample WAL');
      assert.equal(existsSync(demo), false);
      assert.equal(readFileSync(normal, 'utf8'), 'normal application data');
    } finally {
      reset.release();
    }
    assert.equal(existsSync(join(directory, 'demo.lock')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('demo startup rejects normal-database links before modifying either file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trolley-demo-links-'));
  const normal = join(directory, 'trolley.sqlite');
  const demo = join(directory, 'demo.sqlite');
  try {
    writeFileSync(normal, 'normal application data');
    linkSync(normal, demo);
    assert.throws(() => prepareDemoDatabase(directory, { reset: true }), /separate file/);
    unlinkSync(demo);
    symlinkSync(normal, demo);
    assert.throws(() => prepareDemoDatabase(directory, { reset: true }), /separate file/);
    assert.equal(readFileSync(normal, 'utf8'), 'normal application data');
    assert.equal(existsSync(join(directory, 'demo.lock')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
