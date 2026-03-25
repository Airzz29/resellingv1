const { getDb } = require('./db');

function getDeliveryUsage(username, productId) {
  const database = getDb();
  const row = database
    .prepare(
      'SELECT email, created_at FROM delivery_email_usage WHERE username = ? AND product_id = ?'
    )
    .get(username, productId);
  if (!row) return null;
  return { email: row.email, createdAt: row.created_at };
}

function listDeliveryUsageByUser(username) {
  const database = getDb();
  const rows = database
    .prepare(
      'SELECT product_id, email, created_at FROM delivery_email_usage WHERE username = ?'
    )
    .all(username);
  return rows.map((row) => ({
    productId: row.product_id,
    email: row.email,
    createdAt: row.created_at,
  }));
}

function upsertDeliveryUsage(username, productId, email) {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO delivery_email_usage (username, product_id, email)
       VALUES (?, ?, ?)
       ON CONFLICT (username, product_id)
       DO UPDATE SET email = excluded.email`
    )
    .run(username, productId, email);
}

function recordDeliveryIfNew(username, productId, email) {
  const existing = getDeliveryUsage(username, productId);
  if (!existing) return { status: 'new' };

  var a = String(existing.email || '').trim().toLowerCase();
  var b = String(email || '').trim().toLowerCase();

  if (a && b && a === b) return { status: 'same' };
  return { status: 'different', existingEmail: existing.email };
}

function resetUserDeliveryUsage(username) {
  const database = getDb();
  database
    .prepare('DELETE FROM delivery_email_usage WHERE username = ?')
    .run(username);
}

function resetUserDeliveryUsageForProduct(username, productId) {
  const database = getDb();
  database
    .prepare(
      'DELETE FROM delivery_email_usage WHERE username = ? AND product_id = ?'
    )
    .run(username, productId);
}

module.exports = {
  getDeliveryUsage,
  listDeliveryUsageByUser,
  recordDeliveryIfNew,
  upsertDeliveryUsage,
  resetUserDeliveryUsage,
  resetUserDeliveryUsageForProduct,
};

