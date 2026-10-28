require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

async function main() {
  await db.initialize();
  try {
    await db.execute(`BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE schema_migrations (name VARCHAR2(200 CHAR) PRIMARY KEY, applied_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL)';
    EXCEPTION WHEN OTHERS THEN
      IF SQLCODE != -955 THEN RAISE; END IF;
    END;`);
    const applied = new Set((await db.all('SELECT name FROM schema_migrations')).map(row => row.name));
    const dir = path.resolve(__dirname, '..', 'migrations', 'oracle');
    const files = fs.readdirSync(dir).filter(file => /^\d+.*\.sql$/i.test(file)).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const statements = fs.readFileSync(path.join(dir, file), 'utf8')
        .split(';').map(sql => sql.trim()).filter(Boolean);
      for (const statement of statements) {
        try { await db.execute(statement); }
        catch (error) {
          if (error.errorNum !== 955) throw error;
        }
      }
      await db.execute('INSERT INTO schema_migrations (name) VALUES (:name)', { name: file });
      console.log(`Applied Oracle migration: ${file}`);
    }
  } finally {
    await db.close();
  }
}

main().catch(error => { console.error(`Oracle migration failed: ${error.message}`); process.exitCode = 1; });
