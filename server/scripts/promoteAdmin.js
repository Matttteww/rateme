/**
 * Назначить admin: node server/scripts/promoteAdmin.js <username>
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const { initPlatformDb, getDb } = require("../platform/db");

const username = process.argv[2];
if (!username) {
  console.error("Использование: node server/scripts/promoteAdmin.js <логин>");
  process.exit(1);
}

initPlatformDb();
const db = getDb();
const row = db.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE").get(username);
if (!row) {
  console.error("Пользователь не найден:", username);
  process.exit(1);
}
db.prepare("UPDATE users SET staff_role = 'admin' WHERE id = ?").run(row.id);
console.log(`OK: @${row.username} теперь admin`);
