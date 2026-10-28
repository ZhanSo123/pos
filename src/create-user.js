require('dotenv').config();
const readline = require('node:readline/promises');
const bcrypt = require('bcryptjs');
const db = require('./db');

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const username = (await rl.question('Username: ')).trim();
    const password = await rl.question('Password (minimum 8 characters): ');
    const role = (await rl.question('Role (cashier/admin) [cashier]: ')).trim() || 'cashier';
    if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username)) throw new Error('Username must be 3–50 letters, numbers, dots, underscores, or hyphens.');
    if (password.length < 8) throw new Error('Password must contain at least 8 characters.');
    if (!['cashier', 'admin'].includes(role)) throw new Error('Role must be cashier or admin.');
    await db.initialize();
    const passwordHash = await bcrypt.hash(password, 12);
    await db.insert('INSERT INTO users (username, password_hash, role) VALUES (:username, :password_hash, :role)', {
      username, password_hash: passwordHash, role
    });
    console.log(`Created ${role} user "${username}" in Oracle Database.`);
  } finally {
    rl.close();
    await db.close();
  }
}

main().catch(error => { console.error(error.errorNum === 1 ? 'A user with that username already exists.' : error.message); process.exitCode = 1; });
