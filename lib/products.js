const path = require('path');
const { getDb } = require('./db');

function normalizeString(s) {
  if (s === undefined || s === null) return '';
  return String(s);
}

function listProducts() {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT id, name, price, category, size, description, cover_url, delivery_url, delivery_file_path, delivery_file_name
      , delivery_links
       FROM products
       ORDER BY CASE WHEN size = 'big' THEN 0 ELSE 1 END, category ASC, name ASC`
    )
    .all();

  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price || 0),
    category: r.category,
    size: r.size,
    desc: r.description,
    coverUrl: r.cover_url || '',
    deliveryUrl: r.delivery_url || '',
    deliveryLinks: r.delivery_links || '',
    deliveryFilePath: r.delivery_file_path || '',
    deliveryFileName: r.delivery_file_name || '',
  }));

  // Smart featured behavior: only the first "big" item stays featured.
  let featuredUsed = false;
  return mapped.map((p) => {
    if (p.size !== 'big') return p;
    if (!featuredUsed) {
      featuredUsed = true;
      return p;
    }
    return { ...p, size: 'normal' };
  });
}

function listCategories() {
  const database = getDb();
  const rows = database
    .prepare('SELECT DISTINCT category FROM products ORDER BY category ASC')
    .all();
  return rows.map((r) => r.category).filter(Boolean);
}

function getProductById(id) {
  const database = getDb();
  const row = database
    .prepare(
      'SELECT id, name, price, category, size, description, cover_url, delivery_url, delivery_links, delivery_file_path, delivery_file_name FROM products WHERE id = ?'
    )
    .get(id);
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    price: Number(row.price || 0),
    category: row.category,
    size: row.size,
    desc: row.description,
    coverUrl: row.cover_url || '',
    deliveryUrl: row.delivery_url || '',
    deliveryLinks: row.delivery_links || '',
    deliveryFilePath: row.delivery_file_path || '',
    deliveryFileName: row.delivery_file_name || '',
  };
}

function createProduct({ id, name, price, category, size, description, coverUrl, deliveryUrl, deliveryLinks, deliveryFilePath, deliveryFileName }) {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO products (id, name, price, category, size, description, cover_url, delivery_url, delivery_links, delivery_file_path, delivery_file_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(id),
      normalizeString(name),
      Number(price || 0),
      normalizeString(category || 'Other'),
      normalizeString(size || 'normal'),
      normalizeString(description || ''),
      coverUrl || null,
      normalizeString(deliveryUrl || '') || null,
      normalizeString(deliveryLinks || '') || null,
      normalizeString(deliveryFilePath || '') || null,
      normalizeString(deliveryFileName || '') || null
    );
}

function updateProduct(productId, fields) {
  const database = getDb();
  const p = getProductById(productId);
  if (!p) throw new Error('Product not found');

  const next = {
    name: fields.name !== undefined ? normalizeString(fields.name) : p.name,
    price: fields.price !== undefined ? Number(fields.price || 0) : p.price,
    category:
      fields.category !== undefined
        ? normalizeString(fields.category || 'Other')
        : p.category,
    size:
      fields.size !== undefined ? normalizeString(fields.size || 'normal') : p.size,
    description:
      fields.description !== undefined ? normalizeString(fields.description) : p.desc,
    coverUrl: fields.coverUrl !== undefined ? fields.coverUrl : p.coverUrl,
    deliveryUrl:
      fields.deliveryUrl !== undefined ? normalizeString(fields.deliveryUrl) : p.deliveryUrl,
    deliveryLinks:
      fields.deliveryLinks !== undefined ? normalizeString(fields.deliveryLinks) : p.deliveryLinks,
    deliveryFilePath:
      fields.deliveryFilePath !== undefined
        ? normalizeString(fields.deliveryFilePath)
        : p.deliveryFilePath,
    deliveryFileName:
      fields.deliveryFileName !== undefined
        ? normalizeString(fields.deliveryFileName)
        : p.deliveryFileName,
  };

  database
    .prepare(
      `UPDATE products
       SET name = ?, price = ?, category = ?, size = ?, description = ?, cover_url = ?, delivery_url = ?, delivery_links = ?, delivery_file_path = ?, delivery_file_name = ?
       WHERE id = ?`
    )
    .run(
      next.name,
      next.price,
      next.category,
      next.size,
      next.description,
      next.coverUrl || null,
      next.deliveryUrl || null,
      next.deliveryLinks || null,
      next.deliveryFilePath || null,
      next.deliveryFileName || null,
      productId
    );
}

function deleteProduct(productId) {
  const database = getDb();
  // Clean up quality media for this product.
  database
    .prepare('DELETE FROM product_quality_bundles WHERE product_id = ?')
    .run(productId);
  database.prepare('DELETE FROM products WHERE id = ?').run(productId);
}

module.exports = {
  listProducts,
  listCategories,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};

