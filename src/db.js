const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

let pool;

async function initialize() {
  const required = ['ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Set ${missing.join(', ')} in .env to connect to Oracle Database.`);
  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: Number(process.env.ORACLE_POOL_MIN || 1),
    poolMax: Number(process.env.ORACLE_POOL_MAX || 8),
    poolIncrement: 1,
    poolTimeout: 60
  });
  const connection = await pool.getConnection();
  try { await connection.execute('SELECT 1 AS ok FROM dual'); }
  finally { await connection.close(); }
}

function normalizeRows(rows = []) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])));
}

async function withConnection(work) {
  if (!pool) throw new Error('Oracle connection pool has not been initialized.');
  const connection = await pool.getConnection();
  try { return await work(connection); }
  finally { await connection.close(); }
}

async function get(sql, binds = {}, connection = null) {
  const run = async current => {
    const result = await current.execute(sql, binds);
    return normalizeRows(result.rows)[0] || null;
  };
  return connection ? run(connection) : withConnection(run);
}

async function all(sql, binds = {}, connection = null) {
  const run = async current => normalizeRows((await current.execute(sql, binds)).rows);
  return connection ? run(connection) : withConnection(run);
}

async function execute(sql, binds = {}, connection = null) {
  const run = async current => current.execute(sql, binds, { autoCommit: !connection });
  return connection ? run(connection) : withConnection(run);
}

async function insert(sql, binds = {}, connection = null) {
  const outBinds = { ...binds, out_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } };
  const statement = `${sql} RETURNING id INTO :out_id`;
  const result = await execute(statement, outBinds, connection);
  return Number(result.outBinds.out_id[0]);
}

async function transaction(work) {
  return withConnection(async connection => {
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { /* keep the original failure */ }
      throw error;
    }
  });
}

async function close() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.close(10);
}

module.exports = { initialize, get, all, execute, insert, transaction, close, withConnection, normalizeRows };
