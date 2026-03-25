const path = require('path');
const { getDb } = require('./db');
const { getProductById } = require('./products');

function toPublicUrl(filePath) {
  // We store URLs directly in the DB (starting with /uploads/...), but keep a safe fallback.
  if (!filePath) return '';
  if (typeof filePath === 'string' && filePath.startsWith('/')) return filePath;
  return '/' + String(filePath).replace(/^\/+/, '');
}

function getUploadsBaseDir() {
  return path.join(__dirname, '..', 'uploads');
}

function saveCoverMap(productIds) {
  const database = getDb();
  const rows = database
    .prepare(
      `
      SELECT b.product_id, i.file_path
      FROM product_quality_images i
      JOIN product_quality_bundles b ON b.id = i.bundle_id
      WHERE i.is_cover = 1
      AND b.product_id IN (${productIds.map(() => '?').join(',')})
      ORDER BY b.created_at DESC
      `
    )
    .all(...productIds);

  const map = {};
  rows.forEach((r) => {
    if (!map[r.product_id] && r.file_path) {
      map[r.product_id] = toPublicUrl(r.file_path);
    }
  });
  return map;
}

function getCoversForAllProducts(productIds) {
  const database = getDb();
  if (!productIds.length) return {};

  const covers = saveCoverMap(productIds);
  // IMPORTANT: only use images explicitly marked as cover.
  // If no image is marked as cover, we return no cover so the UI shows a placeholder.
  return covers;
}

function getProductQuality(productId) {
  const database = getDb();
  const product = getProductById(productId);
  if (!product) return null;

  const rows = database
    .prepare(
      `
      SELECT
        b.id AS bundle_id,
        b.reviewer,
        b.review_text,
        b.created_at,
        i.file_path,
        i.is_cover
      FROM product_quality_bundles b
      JOIN product_quality_images i ON i.bundle_id = b.id
      WHERE b.product_id = ?
      ORDER BY b.created_at DESC, i.id ASC
      `
    )
    .all(productId);

  const bundlesById = {};
  const order = [];

  rows.forEach((r) => {
    if (!bundlesById[r.bundle_id]) {
      bundlesById[r.bundle_id] = {
        id: r.bundle_id,
        reviewer: r.reviewer || '',
        reviewText: r.review_text || '',
        createdAt: r.created_at,
        images: [],
        hasCover: false,
      };
      order.push(r.bundle_id);
    }
    const url = toPublicUrl(r.file_path);
    if (url) bundlesById[r.bundle_id].images.push({ url, isCover: !!r.is_cover });
    if (r.is_cover) bundlesById[r.bundle_id].hasCover = true;
  });

  const bundles = order.map((id) => bundlesById[id]).filter(Boolean);
  return { product, bundles };
}

function addProductQualityBundle({ productId, reviewer, reviewText, imageUrls, setCover }) {
  const database = getDb();

  const bundleInsert = database
    .prepare(
      `INSERT INTO product_quality_bundles (product_id, reviewer, review_text)
       VALUES (?, ?, ?)`
    )
    .run(productId, reviewer || '', reviewText || '');

  const bundleId = bundleInsert.lastInsertRowid;
  const imageInsert = database.prepare(
    `INSERT INTO product_quality_images (bundle_id, file_path, is_cover)
     VALUES (?, ?, ?)`
  );

  imageUrls.forEach((url, idx) => {
    // Some SQLite drivers refuse boolean bindings; store as integer 0/1.
    const isCover = setCover ? (idx === 0 ? 1 : 0) : 0;
    imageInsert.run(bundleId, url, isCover);
  });

  return bundleId;
}

module.exports = {
  getCoversForAllProducts,
  getProductQuality,
  addProductQualityBundle,
};

