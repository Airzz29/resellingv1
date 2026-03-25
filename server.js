const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { getUploadsDir } = require('./lib/storage');
const store = require('./lib/store');
const { initDb, getDb } = require('./lib/db');
const {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('./lib/products');
const { getProductQuality, addProductQualityBundle } = require('./lib/media');
const {
  getDeliveryUsage,
  listDeliveryUsageByUser,
  upsertDeliveryUsage,
  resetUserDeliveryUsageForProduct,
} = require('./lib/deliveries');

const rateLimitBuckets = new Map();
const RATE_LIMIT_WINDOW_LOGIN_MS = Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_WINDOW_SEND_MS = Number(process.env.RATE_LIMIT_SEND_WINDOW_MS || 10 * 60 * 1000);
const RATE_LIMIT_LOGIN_IP_MAX = Number(process.env.RATE_LIMIT_LOGIN_IP_MAX || 25);
const RATE_LIMIT_LOGIN_USER_MAX = Number(process.env.RATE_LIMIT_LOGIN_USER_MAX || 10);
const RATE_LIMIT_SEND_IP_MAX = Number(process.env.RATE_LIMIT_SEND_IP_MAX || 30);
const RATE_LIMIT_SEND_USER_MAX = Number(process.env.RATE_LIMIT_SEND_USER_MAX || 12);
const RATE_LIMIT_SEND_EMAIL_MAX = Number(process.env.RATE_LIMIT_SEND_EMAIL_MAX || 8);

function checkRateLimit(scope, key, maxHits, windowMs) {
  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
  let bucket = rateLimitBuckets.get(bucketKey);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  rateLimitBuckets.set(bucketKey, bucket);
  return {
    limited: bucket.count > maxHits,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function enforceRateLimit(req, res, scope, key, maxHits, windowMs, message) {
  const result = checkRateLimit(scope, key, maxHits, windowMs);
  if (!result.limited) return false;
  res.set('Retry-After', String(result.retryAfterSec));
  res.status(429).json({ ok: false, message });
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, 60 * 1000).unref();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function formatLoginLocation(req) {
  const ip = getClientIp(req);
  return ip && ip !== 'unknown' ? `IP ${ip}` : 'unknown location';
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const ADMIN_CREDENTIALS = [
  { username: 'Cory', password: 'corysells1.1' },
  { username: 'Airzz', password: 'airzzsells101' },
];
const UPLOADS_DIR = getUploadsDir();
const PRODUCT_COVERS_DIR = path.join(UPLOADS_DIR, 'product-covers');
const PRODUCT_DELIVERY_FILES_DIR = path.join(UPLOADS_DIR, 'product-delivery-files');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PRODUCT_COVERS_DIR))
  fs.mkdirSync(PRODUCT_COVERS_DIR, { recursive: true });
if (!fs.existsSync(PRODUCT_DELIVERY_FILES_DIR))
  fs.mkdirSync(PRODUCT_DELIVERY_FILES_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const productId = req.params.productId;
      const dir = path.join(UPLOADS_DIR, productId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const fallback = file.fieldname === 'deliveryFile' ? '.bin' : '.jpg';
      const safeExt = ext && ext.length <= 10 ? ext : fallback;
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${safeExt}`);
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 12,
  },
  fileFilter: (req, file, cb) => {
    const t = file.mimetype || '';
    if (!/^image\//.test(t)) return cb(new Error('Only image uploads are allowed.'));
    cb(null, true);
  },
});

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const productId =
        (req.params && req.params.productId) || req.body.id || req.body.productId;
      const baseDir =
        file.fieldname === 'deliveryFile'
          ? PRODUCT_DELIVERY_FILES_DIR
          : PRODUCT_COVERS_DIR;
      const dir = path.join(baseDir, String(productId || 'unknown'));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ext && ext.length <= 6 ? ext : '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${safeExt}`);
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
    files: 2,
  },
  fileFilter: (req, file, cb) => {
    const t = file.mimetype || '';
    if (file.fieldname === 'cover') {
      if (!/^image\//.test(t)) return cb(new Error('Cover must be an image.'));
      return cb(null, true);
    }
    if (file.fieldname === 'deliveryFile') {
      const allowedDoc =
        /^application\/pdf$/.test(t) ||
        /^application\/zip$/.test(t) ||
        /^application\/x-zip-compressed$/.test(t) ||
        /^application\/octet-stream$/.test(t);
      if (!allowedDoc) {
        return cb(new Error('Delivery file must be a PDF or ZIP file.'));
      }
      return cb(null, true);
    }
    cb(null, true);
  },
});

app.use(
  session({
    name: 'cjresells.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-change-in-production',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

async function requireCustomer(req, res, next) {
  if (!(req.session && req.session.userId)) {
    if (req.originalUrl.startsWith('/api')) {
      return res.status(401).json({ ok: false, message: 'Please sign in again.' });
    }
    return res.redirect('/login');
  }

  try {
    const active = await store.getUserSessionInfo(req.session.userId);
    const expected = active ? active.sessionKey : '';
    const location = active && active.sessionLocation ? active.sessionLocation : 'unknown location';
    if (!expected || expected !== req.session.sessionKey) {
      req.session.destroy(() => {});
      if (req.originalUrl.startsWith('/api')) {
        return res.status(401).json({
          ok: false,
          message: `A new login was detected from ${location}. Please sign in again.`,
        });
      }
      return res.redirect(`/login?forced=${encodeURIComponent(`A new login was detected from ${location}.`)}`);
    }
  } catch (err) {
    console.error(err);
    if (req.originalUrl.startsWith('/api')) {
      return res.status(500).json({ ok: false, message: 'Server error. Try again.' });
    }
    return res.redirect('/login');
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (req.originalUrl.startsWith('/api')) {
    return res.status(401).json({ ok: false, message: 'Admin sign-in required.' });
  }
  return res.redirect('/admin');
}

function getMailer() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user, pass },
  });
}

function parseDeliveryLinks(rawLinks, fallbackLink) {
  const lines = String(rawLinks || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const links = lines.filter((u) => /^https?:\/\//i.test(u));
  if (!links.length && fallbackLink && /^https?:\/\//i.test(fallbackLink)) {
    return [fallbackLink.trim()];
  }
  return links;
}

function buildProductEmail(productName, deliveryLinks, hasAttachment, attachmentName) {
  const links = Array.isArray(deliveryLinks) ? deliveryLinks.filter(Boolean) : [];
  const hasLink = links.length > 0;
  const isGuideOnly = hasAttachment && !hasLink;
  const subject = 'Your cj.resells Product';
  const linkTextLines = hasLink ? [`Access links:`, ...links.map((u, i) => `${i + 1}. ${u}`)] : [];
  const text = [
    `Hi,`,
    ``,
    isGuideOnly ? `Here is your guide for ${productName}.` : `You requested: ${productName}`,
    ...linkTextLines,
    hasAttachment ? `Guide attachment: ${attachmentName || 'Included in this email'}` : '',
    ``,
    `This is your delivery from cj.resells.`,
    ``,
    `— cj.resells`,
  ]
    .filter(Boolean)
    .join('\n');
  const html = `
    <div style="margin:0;padding:0;background:#060912;color:#eef2ff;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
        Your cj.resells item is ready.
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060912;padding:30px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#0b1328;border:1px solid #253a74;border-radius:18px;overflow:hidden;box-shadow:0 20px 48px rgba(6,10,24,0.62);">
              <tr>
                <td style="padding:24px 24px 14px;background:linear-gradient(180deg,#121f4a 0%,#101b3d 100%);border-bottom:1px solid #2a427f;">
                  <p style="margin:0 0 8px 0;color:#aebeff;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;">cj.resells</p>
                  <h1 style="margin:0;color:#f7f9ff;font-size:28px;line-height:1.2;font-weight:800;">Your supplier item is ready</h1>
                  <p style="margin:10px 0 0;color:#bfccff;font-size:13px;line-height:1.6;">Secure delivery from your cj.resells dashboard.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:22px 24px 24px;">
                  <p style="margin:0 0 14px 0;color:#d9e1ff;font-size:16px;line-height:1.7;">
                    ${isGuideOnly ? 'Here is your guide for:' : 'You requested:'}
                    <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#1b2f68;color:#edf2ff;border:1px solid #3859b3;font-weight:700;">
                      ${escapeHtml(productName)}
                    </span>
                  </p>
                  ${
                    hasLink
                      ? `<p style="margin:0 0 14px 0;color:#c4d0ff;font-size:14px;line-height:1.7;">Use your access links below:</p>
                  ${links
                    .map(
                      (u, idx) =>
                        `<p style="margin:0 0 12px 0;"><a href="${escapeHtml(u)}" style="display:inline-block;padding:13px 22px;background:linear-gradient(135deg,#6e85ff 0%,#7f68ff 100%);color:#ffffff;text-decoration:none;border-radius:11px;font-weight:800;font-size:15px;letter-spacing:0.01em;">Open link ${idx + 1}</a></p>`
                    )
                    .join('')}
                  <p style="margin:0 0 6px 0;color:#9fb2ec;font-size:12px;line-height:1.6;font-weight:700;">
                    Backup link:
                  </p>
                  <p style="margin:0 0 18px 0;color:#9dafeb;font-size:12px;line-height:1.7;word-break:break-all;">
                    ${links
                      .map(
                        (u, idx) =>
                          `Link ${idx + 1}: ${escapeHtml(u)}`
                      )
                      .join('<br />')}
                  </p>`
                      : isGuideOnly
                        ? `<p style="margin:0 0 18px 0;color:#c4d0ff;font-size:14px;line-height:1.7;">Your guide is attached to this email. Download the file below.</p>`
                        : `<p style="margin:0 0 18px 0;color:#c4d0ff;font-size:14px;line-height:1.7;">Your request was received. Your item link is not set yet, so support will follow up manually.</p>`
                  }
                  ${
                    hasAttachment
                      ? `<div style="margin:0 0 18px 0;padding:14px;border:1px solid #3a5bb4;border-radius:12px;background:rgba(111,133,255,0.12);">
                    <p style="margin:0 0 8px 0;color:#dce6ff;font-size:13px;line-height:1.6;font-weight:700;">Here is your guide for ${escapeHtml(productName)}</p>
                    <p style="margin:0;color:#afc0f5;font-size:12px;line-height:1.6;">File: ${escapeHtml(attachmentName || 'Guide file')}</p>
                  </div>`
                      : ''
                  }
                  <div style="height:1px;background:#243a77;margin:18px 0;"></div>
                  <p style="margin:0;color:#9db0ea;font-size:12px;line-height:1.7;">
                    This is an automated delivery email from cj.resells.<br />
                    Need help? Message support on Instagram: @cjay.resells
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shopLocals(req) {
  const ownedIds = Array.isArray(req.session.visibleIds) ? req.session.visibleIds : [];
  return {
    customer: req.session.userId || null,
    ownedIds,
  };
}

app.get('/', (req, res) => {
  const products = listProducts();
  res.render('shop', {
    title: 'cj.resells — Supplier storefront',
    ...shopLocals(req),
    products,
  });
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  const wanted = typeof req.query.wanted === 'string' ? req.query.wanted.trim() : '';
  const wantedProduct = wanted ? getProductById(wanted) : null;
  const forcedMsg =
    typeof req.query.forced === 'string' && req.query.forced.trim()
      ? req.query.forced.trim()
      : null;
  res.render('login', {
    title: 'Sign in — cj.resells',
    error: forcedMsg,
    wantedId: wantedProduct ? wantedProduct.id : null,
    wantedProduct,
  });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ipKey = req.ip || req.socket.remoteAddress || 'unknown';
  const userKey = String(username || '').trim().toLowerCase() || 'unknown';
  const wanted = typeof req.body.wanted === 'string' ? req.body.wanted.trim() : '';
  const wantedProduct = wanted ? getProductById(wanted) : null;
  const ipRate = checkRateLimit(
    'login-ip',
    ipKey,
    RATE_LIMIT_LOGIN_IP_MAX,
    RATE_LIMIT_WINDOW_LOGIN_MS
  );
  if (ipRate.limited) {
    return res.status(429).render('login', {
      title: 'Sign in — cj.resells',
      error: 'Too many sign-in attempts from this IP. Please try again shortly.',
      wantedId: wantedProduct ? wantedProduct.id : null,
      wantedProduct,
    });
  }
  const userRate = checkRateLimit(
    'login-user',
    userKey,
    RATE_LIMIT_LOGIN_USER_MAX,
    RATE_LIMIT_WINDOW_LOGIN_MS
  );
  if (userRate.limited) {
    return res.status(429).render('login', {
      title: 'Sign in — cj.resells',
      error: 'Too many sign-in attempts for this account. Please try again shortly.',
      wantedId: wantedProduct ? wantedProduct.id : null,
      wantedProduct,
    });
  }

  let user;
  try {
    user = await store.verifyLogin(username, password);
  } catch (err) {
    console.error(err);
    return res.status(500).render('login', {
      title: 'Sign in — cj.resells',
      error: 'Server error. Try again later.',
      wantedId: wantedProduct ? wantedProduct.id : null,
      wantedProduct,
    });
  }

  if (user) {
    const sessionKey = crypto.randomUUID();
    const sessionLocation = formatLoginLocation(req);
    try {
      await store.setUserSessionKey(user.username, sessionKey, sessionLocation);
    } catch (err) {
      console.error(err);
      return res.status(500).render('login', {
        title: 'Sign in — cj.resells',
        error: 'Server error. Try again later.',
        wantedId: wantedProduct ? wantedProduct.id : null,
        wantedProduct,
      });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).render('login', {
          title: 'Sign in — cj.resells',
          error: 'Session error. Try again.',
          wantedId: wantedProduct ? wantedProduct.id : null,
          wantedProduct,
        });
      }
      req.session.userId = user.username;
      req.session.sessionKey = sessionKey;
      req.session.visibleIds = user.visibleIds;
      req.session.admin = false;
      return res.redirect('/dashboard');
    });
    return;
  }

  res.status(401).render('login', {
    title: 'Sign in — cj.resells',
    error: 'Invalid username or password.',
    wantedId: wantedProduct ? wantedProduct.id : null,
    wantedProduct,
  });
});

app.post('/logout', async (req, res) => {
  const username = req.session && req.session.userId ? req.session.userId : '';
  const sessionKey = req.session && req.session.sessionKey ? req.session.sessionKey : '';
  if (username && sessionKey) {
    try {
      await store.clearUserSessionKeyIfMatch(username, sessionKey);
    } catch (err) {
      console.error(err);
    }
  }
  req.session.destroy(() => res.redirect('/'));
});

app.get('/dashboard', requireCustomer, (req, res) => {
  const allowed = new Set(req.session.visibleIds || []);
  const allProducts = listProducts();
  const ownedProducts = allProducts.filter((p) => allowed.has(p.id));
  const lockedProducts = allProducts.filter((p) => !allowed.has(p.id));
  const sentRows = listDeliveryUsageByUser(req.session.userId);
  const sentMap = {};
  sentRows.forEach((row) => {
    sentMap[row.productId] = {
      email: row.email,
      createdAt: row.createdAt,
    };
  });
  res.render('dashboard', {
    title: 'Dashboard — cj.resells',
    ownedProducts,
    lockedProducts,
    customer: req.session.userId,
    sentMap,
  });
});

app.get('/payment', (req, res) => {
  const rawFor = typeof req.query.for === 'string' ? req.query.for.trim() : '';
  const productIds = rawFor
    ? rawFor
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const highlightProducts = productIds
    .map((id) => getProductById(id))
    .filter(Boolean);
  const highlightProduct =
    highlightProducts.length === 1 ? highlightProducts[0] : null;

  const boughtNames = highlightProducts.map((p) => p.name);
  const transferDescription = boughtNames.length
    ? `bought: ${boughtNames.join(', ')}`
    : 'bought: cj.resells access';
  const returnDashboard = req.query.return === 'dashboard';
  const backHref = returnDashboard ? '/dashboard' : '/';
  const backLabel = returnDashboard ? 'Back to dashboard' : 'Back to shop';
  res.render('payment', {
    title: 'Get access — cj.resells',
    highlightProduct,
    highlightProducts,
    transferDescription,
    returnDashboard,
    backHref,
    backLabel,
  });
});

app.get('/product/:productId/quality', (req, res) => {
  const productId = req.params.productId;
  const product = getProductById(productId);
  if (!product) {
    return res.status(404).render('404', { title: 'Not found — cj.resells' });
  }

  const quality = getProductQuality(productId);
  const backParam = typeof req.query.back === 'string' ? req.query.back : '';
  let backTo = '/';
  if (backParam === 'dashboard') backTo = '/dashboard';
  if (backParam === 'shop') backTo = '/';
  const customer = req.session && req.session.userId ? req.session.userId : null;
  const allowed = req.session && req.session.visibleIds ? req.session.visibleIds : [];
  const hasAccess = Array.isArray(allowed) ? allowed.includes(productId) : false;
  res.render('product_quality', {
    title: `Quality checks — ${product.name} — cj.resells`,
    productId,
    quality,
    backTo,
    customer,
    hasAccess,
  });
});

function renderAdminProductQuality(res, productId, opts) {
  const product = getProductById(productId);
  const quality = getProductQuality(productId);
  res.render('admin_product_quality', {
    title: `Admin quality media — ${product ? product.name : productId}`,
    adminLoggedIn: true,
    productId,
    product,
    quality,
    error: opts && opts.error ? opts.error : null,
    success: opts && opts.success ? opts.success : null,
  });
}

app.get('/admin/products/:productId/quality', requireAdmin, (req, res) => {
  const productId = req.params.productId;
  if (!getProductById(productId)) return res.redirect('/admin');
  renderAdminProductQuality(res, productId, {});
});

app.post(
  '/admin/products/:productId/quality',
  requireAdmin,
  upload.array('photos', 12),
  (req, res) => {
    const productId = req.params.productId;
    if (!getProductById(productId)) return res.redirect('/admin');

    const reviewer = (req.body.reviewer || '').trim();
    const reviewText = (req.body.reviewText || '').trim();
    const setCover = req.body.setCover === 'on';

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return renderAdminProductQuality(res, productId, {
        error: 'Please upload at least one photo.',
      });
    }

    const imageUrls = files.map((f) => `/uploads/${productId}/${f.filename}`);
    try {
      addProductQualityBundle({
        productId,
        reviewer,
        reviewText,
        imageUrls,
        setCover,
      });
    } catch (err) {
      return renderAdminProductQuality(res, productId, {
        error: err && err.message ? err.message : 'Could not save media.',
      });
    }

    return renderAdminProductQuality(res, productId, {
      success: 'Uploaded and saved successfully.',
    });
  }
);

app.post(
  '/admin/products/:productId/quality/images/:imageId/delete',
  requireAdmin,
  (req, res) => {
    const productId = req.params.productId;
    const imageId = req.params.imageId;
    if (!productId || !imageId) return res.redirect('/admin');

    try {
      const database = getDb();
      const row = database
        .prepare(
          `SELECT i.file_path
           FROM product_quality_images i
           JOIN product_quality_bundles b ON i.bundle_id = b.id
           WHERE i.id = ? AND b.product_id = ?`
        )
        .get(imageId, productId);

      if (!row) return res.redirect(`/admin/products/${productId}/quality`);

      // Delete DB row first.
      database
        .prepare('DELETE FROM product_quality_images WHERE id = ?')
        .run(imageId);

      // Delete file from persistent uploads.
      const filePath = row.file_path || '';
      const rel = filePath.startsWith('/uploads/')
        ? filePath.replace('/uploads/', '')
        : '';
      if (rel) {
        const absPath = path.join(UPLOADS_DIR, rel);
        if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
      }
    } catch (err) {
      console.error('Delete quality image error:', err && err.message ? err.message : err);
    }

    return res.redirect(`/admin/products/${productId}/quality`);
  }
);

async function renderAdminPanel(res, opts) {
  const q = opts && typeof opts.q === 'string' ? opts.q.trim() : '';
  const page = opts && opts.page ? Number(opts.page) : 1;
  const editUsername = opts && typeof opts.edit === 'string' ? opts.edit.trim() : '';
  const limit = 20;
  const currentPage = Number.isFinite(page) && page > 0 ? page : 1;
  const totalCount = await store.countUsers(q);
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const safePage = Math.min(currentPage, totalPages);
  const offset = (safePage - 1) * limit;

  const users = await store.listUsersPaged(q, limit, offset);
  let editUser = null;
  if (editUsername) {
    const u = await store.getUser(editUsername);
    if (u) editUser = u;
  }

  let walletTotalCents = 0;
  try {
    const database = getDb();
    const cutoff = database
      .prepare(
        `SELECT COALESCE(MAX(id), 0) AS last_reset_id
         FROM admin_wallet_transactions
         WHERE kind = 'reset'`
      )
      .get();
    const lastResetId = cutoff && cutoff.last_reset_id ? Number(cutoff.last_reset_id) : 0;
    const row = database
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
         FROM admin_wallet_transactions
         WHERE id > ? AND (kind IS NULL OR kind != 'reset')`
      )
      .get(lastResetId);
    walletTotalCents = row && row.total_cents ? Number(row.total_cents) : 0;
  } catch (err) {}

  res.render('admin', {
    title: 'Admin — cj.resells',
    adminLoggedIn: true,
    adminUser: res.req && res.req.session ? res.req.session.adminUser : '',
    walletTotalCents,
    users,
    products: listProducts(),
    q,
    page: safePage,
    totalPages,
    editUsername: editUser ? editUser.username : '',
    editVisibleIds: editUser ? editUser.visibleIds : [],
    error: opts.error || null,
    success: opts.success || null,
  });
}

app.get('/admin', async (req, res) => {
  try {
    if (req.session.admin) {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
      const edit = typeof req.query.edit === 'string' ? req.query.edit.trim() : '';
      return await renderAdminPanel(res, { q, page, edit });
    }
    res.render('admin', {
      title: 'Admin — cj.resells',
      adminLoggedIn: false,
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error. Check SQLite file in data/ and server logs.');
  }
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const ok = ADMIN_CREDENTIALS.some(
    (cred) => cred.username === username && cred.password === password
  );
  if (ok) {
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).render('admin', {
          title: 'Admin — cj.resells',
          adminLoggedIn: false,
          error: 'Session error. Try again.',
        });
      }
      req.session.admin = true;
      req.session.adminUser = username;
      delete req.session.userId;
      delete req.session.visibleIds;
      return res.redirect('/admin');
    });
    return;
  }
  res.status(401).render('admin', {
    title: 'Admin — cj.resells',
    adminLoggedIn: false,
    error: 'Invalid admin credentials.',
  });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin'));
});

app.post('/admin/users/create', requireAdmin, async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  let ids = req.body.visibleIds;
  if (ids === undefined) ids = [];
  try {
    await store.createUser(username, password, ids);
  } catch (e) {
    return renderAdminPanel(res, { error: e.message || 'Could not create user.' });
  }

  // Record wallet transaction based on selected product prices.
  try {
    const database = getDb();
    const idArr = Array.isArray(ids) ? ids : [ids];
    const uniqueIds = [...new Set(idArr.filter(Boolean).map(String))];
    let amountCents = 0;
    if (uniqueIds.length) {
      const placeholders = uniqueIds.map(() => '?').join(',');
      const rows = database
        .prepare(`SELECT price FROM products WHERE id IN (${placeholders})`)
        .all(...uniqueIds);
      const totalDollars = rows.reduce((sum, r) => sum + Number(r.price || 0), 0);
      amountCents = Math.round(totalDollars * 100);
    }
    const adminUser = (req.session && req.session.adminUser) ? String(req.session.adminUser) : 'Unknown';
    database
      .prepare(
        `INSERT INTO admin_wallet_transactions (admin_username, created_username, product_ids, amount_cents, kind, meta_json)
         VALUES (?, ?, ?, ?, 'create', NULL)`
      )
      .run(adminUser, username, JSON.stringify(uniqueIds), amountCents);
  } catch (err) {
    console.error('wallet transaction error:', err && err.message ? err.message : err);
  }

  res.redirect('/admin');
});

app.post('/admin/wallet/reset', requireAdmin, (req, res) => {
  try {
    const database = getDb();
    const cutoff = database
      .prepare(
        `SELECT COALESCE(MAX(id), 0) AS last_reset_id
         FROM admin_wallet_transactions
         WHERE kind = 'reset'`
      )
      .get();
    const lastResetId = cutoff && cutoff.last_reset_id ? Number(cutoff.last_reset_id) : 0;
    const totalRow = database
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
         FROM admin_wallet_transactions
         WHERE id > ? AND (kind IS NULL OR kind != 'reset')`
      )
      .get(lastResetId);
    const totalCents = totalRow && totalRow.total_cents ? Number(totalRow.total_cents) : 0;

    const adminUser =
      req.session && req.session.adminUser ? String(req.session.adminUser) : 'Unknown';
    const meta = JSON.stringify({ previousTotalCents: totalCents });
    database
      .prepare(
        `INSERT INTO admin_wallet_transactions (admin_username, created_username, product_ids, amount_cents, kind, meta_json)
         VALUES (?, ?, '[]', 0, 'reset', ?)`
      )
      .run(adminUser, '-', meta);
  } catch (err) {
    console.error('wallet reset error:', err && err.message ? err.message : err);
  }
  return res.redirect('/admin');
});

app.get('/admin/transactions', requireAdmin, (req, res) => {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT id, admin_username, created_username, product_ids, amount_cents, created_at, kind, meta_json
       FROM admin_wallet_transactions
       ORDER BY datetime(created_at) DESC
       LIMIT 200`
    )
    .all();

  const cutoff = database
    .prepare(
      `SELECT COALESCE(MAX(id), 0) AS last_reset_id
       FROM admin_wallet_transactions
       WHERE kind = 'reset'`
    )
    .get();
  const lastResetId = cutoff && cutoff.last_reset_id ? Number(cutoff.last_reset_id) : 0;
  const totalRow = database
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
       FROM admin_wallet_transactions
       WHERE id > ? AND (kind IS NULL OR kind != 'reset')`
    )
    .get(lastResetId);
  const totalCents = totalRow && totalRow.total_cents ? Number(totalRow.total_cents) : 0;

  return res.render('admin_transactions', {
    title: 'Admin — Transactions — cj.resells',
    adminLoggedIn: true,
    adminUser: req.session.adminUser || '',
    totalCents,
    transactions: rows.map((r) => ({
      id: r.id,
      adminUsername: r.admin_username,
      createdUsername: r.created_username,
      kind: r.kind || 'create',
      productData: (() => {
        try {
          const v = JSON.parse(r.product_ids || '[]');
          return v;
        } catch {
          return [];
        }
      })(),
      meta: (() => {
        try {
          const v = JSON.parse(r.meta_json || 'null');
          return v;
        } catch {
          return null;
        }
      })(),
      amountCents: Number(r.amount_cents || 0),
      createdAt: r.created_at,
    })),
  });
});

app.post('/admin/users/update', requireAdmin, async (req, res) => {
  const username = (req.body.username || '').trim();
  let ids = req.body.visibleIds;
  if (ids === undefined) ids = [];
  let beforeIds = [];
  try {
    const u = await store.getUser(username);
    beforeIds = u && Array.isArray(u.visibleIds) ? u.visibleIds : [];
  } catch {}
  try {
    await store.updateUserVisibility(username, ids);
  } catch (e) {
    return renderAdminPanel(res, { error: e.message || 'Could not update user.' });
  }

  // Record wallet transaction for edits (delta based on added/removed items).
  try {
    const afterArr = Array.isArray(ids) ? ids : [ids];
    const afterIds = [...new Set(afterArr.filter(Boolean).map(String))];
    const beforeSet = new Set((beforeIds || []).map(String));
    const afterSet = new Set(afterIds);
    const added = afterIds.filter((id) => !beforeSet.has(id));
    const removed = (beforeIds || []).map(String).filter((id) => !afterSet.has(id));

    if (added.length || removed.length) {
      const database = getDb();
      const allIds = [...new Set([...added, ...removed])];
      let cents = 0;
      if (allIds.length) {
        const placeholders = allIds.map(() => '?').join(',');
        const rows = database
          .prepare(`SELECT id, price FROM products WHERE id IN (${placeholders})`)
          .all(...allIds);
        const priceMap = {};
        rows.forEach((r) => {
          priceMap[String(r.id)] = Math.round(Number(r.price || 0) * 100);
        });
        added.forEach((id) => {
          cents += priceMap[id] || 0;
        });
        removed.forEach((id) => {
          cents -= priceMap[id] || 0;
        });
      }
      const adminUser =
        req.session && req.session.adminUser ? String(req.session.adminUser) : 'Unknown';
      const payload = { type: 'edit', added, removed };
      database
        .prepare(
          `INSERT INTO admin_wallet_transactions (admin_username, created_username, product_ids, amount_cents, kind, meta_json)
           VALUES (?, ?, ?, ?, 'edit', NULL)`
        )
        .run(adminUser, username, JSON.stringify(payload), cents);
    }
  } catch (err) {
    console.error('wallet edit transaction error:', err && err.message ? err.message : err);
  }

  res.redirect('/admin');
});

app.post('/admin/users/delete', requireAdmin, async (req, res) => {
  const username = (req.body.username || '').trim();
  try {
    await store.deleteUser(username);
  } catch (e) {
    return renderAdminPanel(res, { error: e.message || 'Could not delete user.' });
  }
  res.redirect('/admin');
});

app.post('/admin/users/reset-deliveries', requireAdmin, (req, res) => {
  const username = (req.body.username || '').trim();
  const productId = (req.body.productId || '').trim();
  if (!username || !productId) {
    return res.redirect('/admin');
  }
  try {
    resetUserDeliveryUsageForProduct(username, productId);
  } catch (e) {
    return renderAdminPanel(res, {
      edit: username,
      error:
        e && e.message
          ? e.message
          : 'Could not reset delivery email usage for this item.',
    });
  }
  return res.redirect(`/admin?edit=${encodeURIComponent(username)}`);
});

app.get('/admin/storefront-products', requireAdmin, (req, res) => {
  res.render('admin_storefront_products', {
    title: 'Admin — Storefront Products — cj.resells',
    products: listProducts(),
    error: null,
    success: null,
  });
});

app.post(
  '/admin/storefront-products/create',
  requireAdmin,
  coverUpload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'deliveryFile', maxCount: 1 },
  ]),
  (req, res) => {
    const id = (req.body.id || '').trim();
    const name = (req.body.name || '').trim();
    const price = Number(req.body.price || 0);
    const category = (req.body.category || '').trim();
    const size = (req.body.size || 'normal').trim();
    const description = (req.body.description || '').trim();
    const deliveryLinks = (req.body.deliveryLinks || '').trim();
    const firstLink = parseDeliveryLinks(deliveryLinks, '')[0] || '';

    if (!id || !name || !category || !description) {
      return res.render('admin_storefront_products', {
        title: 'Admin — Storefront Products — cj.resells',
        products: listProducts(),
        error: 'Please fill out all required fields (id, name, category, description).',
        success: null,
      });
    }

    const files = req.files || {};
    const coverFile = Array.isArray(files.cover) ? files.cover[0] : null;
    const deliveryFile = Array.isArray(files.deliveryFile) ? files.deliveryFile[0] : null;
    const coverUrl = coverFile
      ? `/uploads/product-covers/${id}/${coverFile.filename}`
      : null;
    const deliveryFilePath = deliveryFile
      ? path.join(PRODUCT_DELIVERY_FILES_DIR, id, deliveryFile.filename)
      : '';
    const deliveryFileName = deliveryFile ? deliveryFile.originalname || deliveryFile.filename : '';

    try {
      createProduct({
        id,
        name,
        price,
        category,
        size: size === 'big' ? 'big' : 'normal',
        description,
        coverUrl,
        deliveryUrl: firstLink,
        deliveryLinks,
        deliveryFilePath,
        deliveryFileName,
      });
      return res.redirect('/admin/storefront-products');
    } catch (e) {
      return res.render('admin_storefront_products', {
        title: 'Admin — Storefront Products — cj.resells',
        products: listProducts(),
        error: e && e.message ? e.message : 'Could not create product.',
        success: null,
      });
    }
  }
);

app.post(
  '/admin/storefront-products/:productId/update',
  requireAdmin,
  coverUpload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'deliveryFile', maxCount: 1 },
  ]),
  (req, res) => {
    const productId = req.params.productId;
    const current = getProductById(productId);
    if (!current) return res.redirect('/admin/storefront-products');

    const name = (req.body.name || '').trim();
    const price = Number(req.body.price || 0);
    const category = (req.body.category || '').trim();
    const size = (req.body.size || 'normal').trim();
    const description = (req.body.description || '').trim();
    const deliveryLinks = (req.body.deliveryLinks || '').trim();
    const firstLink = parseDeliveryLinks(deliveryLinks, '')[0] || '';
    const files = req.files || {};
    const coverFile = Array.isArray(files.cover) ? files.cover[0] : null;
    const deliveryFile = Array.isArray(files.deliveryFile) ? files.deliveryFile[0] : null;

    const coverUrl = coverFile
      ? `/uploads/product-covers/${productId}/${coverFile.filename}`
      : current.coverUrl || null;
    const deliveryFilePath = deliveryFile
      ? path.join(PRODUCT_DELIVERY_FILES_DIR, productId, deliveryFile.filename)
      : current.deliveryFilePath || '';
    const deliveryFileName = deliveryFile
      ? deliveryFile.originalname || deliveryFile.filename
      : current.deliveryFileName || '';

    try {
      updateProduct(productId, {
        name,
        price,
        category,
        size: size === 'big' ? 'big' : 'normal',
        description,
        coverUrl,
        deliveryUrl: firstLink,
        deliveryLinks,
        deliveryFilePath,
        deliveryFileName,
      });
      return res.redirect('/admin/storefront-products');
    } catch (e) {
      return res.render('admin_storefront_products', {
        title: 'Admin — Storefront Products — cj.resells',
        products: listProducts(),
        error: e && e.message ? e.message : 'Could not update product.',
        success: null,
      });
    }
  }
);

app.post('/admin/storefront-products/:productId/delete', requireAdmin, (req, res) => {
  const productId = req.params.productId;
  try {
    deleteProduct(productId);
  } catch (e) {}
  return res.redirect('/admin/storefront-products');
});

app.post('/api/send-product', requireCustomer, async (req, res) => {
  const { email, productId } = req.body;
  const ipKey = req.ip || req.socket.remoteAddress || 'unknown';
  const username = req.session.userId;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ ok: false, message: 'Email is required.' });
  }
  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ ok: false, message: 'Product is required.' });
  }

  const product = getProductById(productId.trim());
  if (!product) {
    return res.status(400).json({ ok: false, message: 'Unknown product.' });
  }

  const allowed = new Set(req.session.visibleIds || []);
  if (!allowed.has(product.id)) {
    return res.status(403).json({
      ok: false,
      message: 'You do not have access to this item. Contact support.',
    });
  }

  const trimmed = email.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  if (!emailOk) {
    return res.status(400).json({ ok: false, message: 'Please enter a valid email address.' });
  }

  const emailKey = trimmed.toLowerCase();
  if (
    enforceRateLimit(
      req,
      res,
      'send-ip',
      ipKey,
      RATE_LIMIT_SEND_IP_MAX,
      RATE_LIMIT_WINDOW_SEND_MS,
      'Too many delivery requests from this IP. Try again later.'
    )
  ) {
    return;
  }
  if (
    enforceRateLimit(
      req,
      res,
      'send-user',
      String(username || '').toLowerCase(),
      RATE_LIMIT_SEND_USER_MAX,
      RATE_LIMIT_WINDOW_SEND_MS,
      'Too many delivery requests for this account. Try again later.'
    )
  ) {
    return;
  }
  if (
    enforceRateLimit(
      req,
      res,
      'send-email',
      emailKey,
      RATE_LIMIT_SEND_EMAIL_MAX,
      RATE_LIMIT_WINDOW_SEND_MS,
      'Too many requests to this email address. Try again later.'
    )
  ) {
    return;
  }

  const trimmedLower = trimmed.toLowerCase();
  const existingUsage = getDeliveryUsage(username, product.id);
  if (existingUsage) {
    const existingLower = String(existingUsage.email || '').trim().toLowerCase();
    if (existingLower && existingLower === trimmedLower) {
      return res.json({ ok: true, message: 'Already sent to this email.' });
    }
    return res.status(409).json({
      ok: false,
      message:
        'This item was already delivered to a different email address. If you need changes, ask admin to reset your delivery email usage.',
    });
  }

  const transporter = getMailer();
  if (!transporter) {
    return res.status(503).json({
      ok: false,
      message:
        'Email is not configured. Set EMAIL_USER and EMAIL_PASS on the server.',
    });
  }

  const deliveryLinks = parseDeliveryLinks(product.deliveryLinks, product.deliveryUrl);
  const from =
    process.env.EMAIL_FROM ||
    `"cj.resells" <${process.env.EMAIL_USER}>`;
  const attachments = [];
  if (product.deliveryFilePath && fs.existsSync(product.deliveryFilePath)) {
    attachments.push({
      filename: product.deliveryFileName || path.basename(product.deliveryFilePath),
      path: product.deliveryFilePath,
    });
  }
  const attachmentName = attachments.length ? attachments[0].filename : '';
  const { subject, text, html } = buildProductEmail(
    product.name,
    deliveryLinks,
    attachments.length > 0,
    attachmentName
  );

  try {
    await transporter.sendMail({
      from,
      to: trimmed,
      subject,
      text,
      html,
      attachments,
    });
    upsertDeliveryUsage(username, product.id, trimmed);
    return res.json({ ok: true, message: 'Sent. Check your inbox (and spam).' });
  } catch (err) {
    console.error('sendMail error:', err.message);
    return res.status(500).json({
      ok: false,
      message: 'Could not send email. Try again or contact support.',
    });
  }
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found — cj.resells' });
});

try {
  initDb();
} catch (err) {
  console.error(err);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`cj.resells listening on http://localhost:${PORT}`);
});
