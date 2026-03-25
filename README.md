# cj.resells

Lightweight **Node.js + Express + EJS** app with plain CSS and vanilla JavaScript. Premium dark storefront, admin-managed logins, per-user product access, **SQLite** via Node’s built-in **`node:sqlite`** (no extra native module), **30-day rolling sessions**, and **Nodemailer** for delivery emails.

## Stack

- **Node.js 22+** (uses built-in `node:sqlite` — you may see an experimental warning; it still persists data correctly)
- Express 4, EJS, `express-session`, `bcryptjs`, Nodemailer

## Database (SQLite)

- Default file: **`data/cjresells.db`** (created on first run).
- Optional **`SQLITE_PATH`** in `.env` — absolute path or path relative to the process working directory.
- Optional **`PERSISTENT_DISK_PATH`** in `.env` — root folder for persistent data (DB + uploads).  
  When set, defaults become:
  - DB: `<PERSISTENT_DISK_PATH>/data/cjresells.db`
  - Uploads: `<PERSISTENT_DISK_PATH>/uploads/...`
- On first run with an **empty** `users` table, legacy **`data/users.json`** is imported once (same bcrypt hashes).

### Deploying (e.g. Render)

Use a **persistent disk** and set:

- `PERSISTENT_DISK_PATH` to your Render disk mount (example: `/var/data`)
- optionally `SQLITE_PATH=/var/data/data/cjresells.db`

This keeps both SQLite and uploaded assets (covers, quality media, guide files) across redeploys.

## Sessions

- Cookie **`maxAge`:** 30 days.  
- **`rolling: true`:** each request extends the expiry so active users stay logged in smoothly.  
- Returning users can open the shop or dashboard without signing in again until the cookie expires.

## Run locally

```bash
npm install
```

Copy `.env.example` → `.env` (email + `SESSION_SECRET`). Start:

```bash
npm start
```

## Flow

- **`/`** — Shop · **`/login`** — Customers · **`/dashboard`** — Split into **Your suppliers** (active lines: **Get** sends email, no price on button) and **Still to unlock** (pay via **`/payment?for=…&return=dashboard`**). Payment page explains **~24h** access updates and optional **comp/free** eligibility copy.
- **`/admin`** — `admin` / `reselling` — manage users and visibility.
- **`/payment`** — Bank instructions (edit placeholders in `views/payment.ejs`).

## Layout

```
├── server.js
├── lib/
│   ├── db.js           # SQLite path, schema, JSON import
│   ├── store.js
│   └── catalog.js
├── data/
│   ├── cjresells.db # created at runtime (gitignored)
│   └── users.json      # optional legacy import
└── public/
```

Email body customization: `buildProductEmail` in `server.js`.

Storefront products can include:
- `delivery_url` (button in email)
- an optional uploaded guide file (PDF/ZIP) attached to delivery email
