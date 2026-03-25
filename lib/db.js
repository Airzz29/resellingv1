const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { PRODUCTS: DEFAULT_PRODUCTS } = require('./catalog');
const { getDataDir } = require('./storage');

let db;

function getDbPath() {
  const custom = process.env.SQLITE_PATH;
  if (custom) return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
  return path.join(getDataDir(), 'cjresells.db');
}

function getDb() {
  if (!db) {
    const dbPath = getDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return db;
}

function initSchema() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      visible_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 20,
      category TEXT NOT NULL DEFAULT 'Other',
      size TEXT NOT NULL DEFAULT 'normal',
      description TEXT NOT NULL DEFAULT '',
      cover_url TEXT,
      delivery_url TEXT,
      delivery_links TEXT,
      delivery_file_path TEXT,
      delivery_file_name TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
  `);

  // Add single-active-session token column for customer logins.
  try {
    database.exec('ALTER TABLE users ADD COLUMN session_key TEXT');
  } catch {}
  try {
    database.exec('ALTER TABLE users ADD COLUMN session_location TEXT');
  } catch {}

  // Add per-product delivery URL for styled email button links.
  try {
    database.exec('ALTER TABLE products ADD COLUMN delivery_url TEXT');
  } catch {}
  try {
    database.exec('ALTER TABLE products ADD COLUMN delivery_links TEXT');
  } catch {}
  try {
    database.exec('ALTER TABLE products ADD COLUMN delivery_file_path TEXT');
  } catch {}
  try {
    database.exec('ALTER TABLE products ADD COLUMN delivery_file_name TEXT');
  } catch {}

  // Product quality media: admin can upload review bundles (text + multiple photos)
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_quality_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      reviewer TEXT,
      review_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_quality_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      is_cover INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (bundle_id) REFERENCES product_quality_bundles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_quality_bundles_product ON product_quality_bundles (product_id);
    CREATE INDEX IF NOT EXISTS idx_quality_images_bundle ON product_quality_images (bundle_id);
    CREATE INDEX IF NOT EXISTS idx_quality_images_cover ON product_quality_images (is_cover);
  `);

  // Limit delivery per user + product (prevents sending the same item to a different person's email)
  database.exec(`
    CREATE TABLE IF NOT EXISTS delivery_email_usage (
      username TEXT NOT NULL,
      product_id TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (username, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_usage_username ON delivery_email_usage (username);
    CREATE INDEX IF NOT EXISTS idx_delivery_usage_product ON delivery_email_usage (product_id);
  `);
}

function migrateFromJsonIfEmpty() {
  const database = getDb();
  const row = database.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c > 0) return;

  const jsonPath = path.join(__dirname, '..', 'data', 'users.json');
  if (!fs.existsSync(jsonPath)) return;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return;
  }

  const users = data.users || [];
  if (!users.length) return;

  const insert = database.prepare(
    `INSERT OR IGNORE INTO users (username, password_hash, visible_ids)
     VALUES (?, ?, ?)`
  );

  for (const u of users) {
    if (!u.username || !u.passwordHash) continue;
    const ids = JSON.stringify(Array.isArray(u.visibleIds) ? u.visibleIds : []);
    insert.run(u.username, u.passwordHash, ids);
  }
  console.log('Imported users from data/users.json into SQLite.');
}

function initDb() {
  getDb();
  initSchema();
  migrateFromJsonIfEmpty();
  seedProductsIfEmpty();
}

function seedProductsIfEmpty() {
  const database = getDb();
  const row = database.prepare('SELECT COUNT(*) AS c FROM products').get();
  if (!row || row.c > 0) return;

  const insert = database.prepare(
    `INSERT INTO products (id, name, price, category, size, description, cover_url)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  );

  DEFAULT_PRODUCTS.forEach((p) => {
    insert.run(
      p.id,
      p.name,
      p.price || 20,
      p.category || 'Other',
      p.size || 'normal',
      p.desc || p.description || ''
    );
  });
}

module.exports = {
  getDb,
  initDb,
};
