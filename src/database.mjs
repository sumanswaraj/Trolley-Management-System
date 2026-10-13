import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

/** The repository owns SQL and transactions; services own business decisions. */
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');

  for (const name of readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
    if (database.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(name)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(readFileSync(join(migrationsDirectory, name), 'utf8'));
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(name, Date.now());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      database.close();
      throw error;
    }
  }

  return {
    raw: database,
    get(sql, ...parameters) { return database.prepare(sql).get(...parameters); },
    all(sql, ...parameters) { return database.prepare(sql).all(...parameters); },
    run(sql, ...parameters) { return database.prepare(sql).run(...parameters); },
    transaction(action) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = action();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    audit(actor, action, entity, details) {
      database.prepare('INSERT INTO audit(actor, action, entity, detail, ts) VALUES (?, ?, ?, ?, ?)')
        .run(actor.id, action, entity, JSON.stringify(details), Date.now());
    },
    close() { database.close(); },
  };
}
