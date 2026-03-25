const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

function normalizeVisibleIds(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return [...new Set(arr.filter(Boolean).map(String))];
}

function parseVisibleIdsColumn(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function listUsers() {
  const database = getDb();
  const rows = database
    .prepare('SELECT username, visible_ids FROM users ORDER BY username ASC')
    .all();
  return rows.map((row) => ({
    username: row.username,
    visibleIds: parseVisibleIdsColumn(row.visible_ids),
  }));
}

async function countUsers(search) {
  const database = getDb();
  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    const row = database
      .prepare('SELECT COUNT(*) AS c FROM users WHERE username LIKE ?')
      .get(q);
    return row && row.c ? Number(row.c) : 0;
  }
  const row = database.prepare('SELECT COUNT(*) AS c FROM users').get();
  return row && row.c ? Number(row.c) : 0;
}

async function listUsersPaged(search, limit, offset) {
  const database = getDb();
  const lim = Number(limit) > 0 ? Number(limit) : 20;
  const off = Number(offset) >= 0 ? Number(offset) : 0;

  let stmt;
  let rows;
  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    stmt = database.prepare(
      'SELECT username, visible_ids FROM users WHERE username LIKE ? ORDER BY username ASC LIMIT ? OFFSET ?'
    );
    rows = stmt.all(q, lim, off);
  } else {
    stmt = database.prepare(
      'SELECT username, visible_ids FROM users ORDER BY username ASC LIMIT ? OFFSET ?'
    );
    rows = stmt.all(lim, off);
  }

  return rows.map((row) => ({
    username: row.username,
    visibleIds: parseVisibleIdsColumn(row.visible_ids),
  }));
}

async function getUser(username) {
  const database = getDb();
  const row = database
    .prepare(
      'SELECT username, password_hash, visible_ids, session_key, session_location FROM users WHERE username = ?'
    )
    .get(username);
  if (!row) return null;
  return {
    username: row.username,
    passwordHash: row.password_hash,
    visibleIds: parseVisibleIdsColumn(row.visible_ids),
    sessionKey: row.session_key || '',
    sessionLocation: row.session_location || '',
  };
}

async function createUser(username, password, visibleIds) {
  if (!username || !password) throw new Error('Username and password required');
  if (username === 'admin') {
    throw new Error('Username "admin" is reserved for the admin panel');
  }
  const existing = await getUser(username);
  if (existing) throw new Error('Username already exists');
  const passwordHash = bcrypt.hashSync(password, 10);
  const ids = normalizeVisibleIds(visibleIds);
  const database = getDb();
  try {
    database
      .prepare(
        `INSERT INTO users (username, password_hash, visible_ids)
         VALUES (?, ?, ?)`
      )
      .run(username, passwordHash, JSON.stringify(ids));
  } catch (e) {
    const msg = e && e.message ? String(e.message) : '';
    if (msg.includes('UNIQUE constraint failed')) {
      throw new Error('Username already exists');
    }
    throw e;
  }
}

async function updateUserVisibility(username, visibleIds) {
  const ids = normalizeVisibleIds(visibleIds);
  const database = getDb();
  const result = database
    .prepare('UPDATE users SET visible_ids = ? WHERE username = ?')
    .run(JSON.stringify(ids), username);
  if (result.changes === 0) throw new Error('User not found');
}

async function deleteUser(username) {
  const database = getDb();
  const result = database.prepare('DELETE FROM users WHERE username = ?').run(username);
  if (result.changes === 0) throw new Error('User not found');
}

async function verifyLogin(username, password) {
  const database = getDb();
  const row = database
    .prepare(
      'SELECT username, password_hash, visible_ids, session_key, session_location FROM users WHERE username = ?'
    )
    .get(username);
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return {
    username: row.username,
    visibleIds: parseVisibleIdsColumn(row.visible_ids),
    sessionKey: row.session_key || '',
    sessionLocation: row.session_location || '',
  };
}

async function setUserSessionKey(username, sessionKey, sessionLocation) {
  const database = getDb();
  const result = database
    .prepare('UPDATE users SET session_key = ?, session_location = ? WHERE username = ?')
    .run(sessionKey || null, sessionLocation || null, username);
  if (result.changes === 0) throw new Error('User not found');
}

async function getUserSessionInfo(username) {
  const database = getDb();
  const row = database
    .prepare('SELECT session_key, session_location FROM users WHERE username = ?')
    .get(username);
  if (!row) return null;
  return {
    sessionKey: row.session_key || '',
    sessionLocation: row.session_location || '',
  };
}

async function getUserSessionKey(username) {
  const info = await getUserSessionInfo(username);
  if (!info) return null;
  return info.sessionKey || '';
}

async function clearUserSessionKeyIfMatch(username, expectedKey) {
  const database = getDb();
  database
    .prepare(
      'UPDATE users SET session_key = NULL, session_location = NULL WHERE username = ? AND session_key = ?'
    )
    .run(username, expectedKey || '');
}

module.exports = {
  listUsers,
  countUsers,
  listUsersPaged,
  getUser,
  createUser,
  updateUserVisibility,
  deleteUser,
  verifyLogin,
  setUserSessionKey,
  getUserSessionInfo,
  getUserSessionKey,
  clearUserSessionKeyIfMatch,
  normalizeVisibleIds,
};
