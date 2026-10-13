import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';

const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination)) {
  throw new Error('Usage: node scripts/backup.mjs <database.sqlite> <new-backup.sqlite>');
}
const database = new DatabaseSync(source, { readOnly: true });
try {
  await backup(database, destination);
  console.log('Consistent database backup completed.');
} finally {
  database.close();
}
