require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const APP_PASSWORD_HASH = process.env.APP_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

const db = new Database(path.join(__dirname, 'data', 'budget.db'));
db.pragma('journal_mode = WAL');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, name)
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- Seed default categories (only if table is empty) ----------
const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare(
    'INSERT INTO categories (kind, name, is_default, sort_order) VALUES (?, ?, 1, ?)'
  );
  const incomeDefaults = [
    'Taz Networks',
    'NextWave Technologies',
    'Rover',
    'The Book Bridge Organization',
    'Other'
  ];
  const expenseDefaults = [
    'Rent',
    'Debt program',
    'Utilities',
    'Groceries',
    'Fast food',
    'Gas / auto',
    'ATM / cash',
    'Shopping',
    'Subscriptions',
    'Pets',
    'Health / pharmacy',
    'Health / gym',
    'Business expense',
    'Gaming',
    'Other'
  ];
  const seed = db.transaction(() => {
    incomeDefaults.forEach((name, i) => insertCat.run('income', name, i));
    expenseDefaults.forEach((name, i) => insertCat.run('expense', name, i));
  });
  seed();
}

// ---------- App setup ----------
const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 days
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ---------- Auth routes ----------
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!APP_PASSWORD_HASH) {
    return res.status(500).json({ error: 'Server not configured: APP_PASSWORD_HASH missing' });
  }
  if (!password || !bcrypt.compareSync(password, APP_PASSWORD_HASH)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  req.session.loggedIn = true;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.loggedIn) });
});

// ---------- Category routes ----------
app.get('/api/categories', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY kind, sort_order, name').all();
  res.json({
    income: rows.filter((r) => r.kind === 'income'),
    expense: rows.filter((r) => r.kind === 'expense')
  });
});

app.post('/api/categories', requireAuth, (req, res) => {
  const { kind, name } = req.body;
  if (!['income', 'expense'].includes(kind) || !name || !name.trim()) {
    return res.status(400).json({ error: 'kind must be income/expense and name required' });
  }
  try {
    const maxOrder =
      db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE kind = ?').get(kind).m;
    const info = db
      .prepare('INSERT INTO categories (kind, name, is_default, sort_order) VALUES (?, ?, 0, ?)')
      .run(kind, name.trim(), maxOrder + 1);
    res.json({ id: info.lastInsertRowid, kind, name: name.trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ---------- Entry routes ----------
app.get('/api/month/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const entries = db
    .prepare(
      `SELECT e.id, e.amount, e.note, c.id AS category_id, c.name AS category_name, c.kind
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE e.year = ? AND e.month = ?
       ORDER BY c.kind, c.sort_order`
    )
    .all(year, month);
  res.json({ entries });
});

app.post('/api/entry', requireAuth, (req, res) => {
  const { year, month, category_id, amount, note } = req.body;
  if (!year || !month || !category_id || amount === undefined || amount === null) {
    return res.status(400).json({ error: 'year, month, category_id, amount are required' });
  }
  const info = db
    .prepare(
      'INSERT INTO entries (year, month, category_id, amount, note) VALUES (?, ?, ?, ?, ?)'
    )
    .run(year, month, category_id, amount, note || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/entry/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Trends ----------
app.get('/api/trends', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.year, e.month, c.kind, SUM(e.amount) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       GROUP BY e.year, e.month, c.kind
       ORDER BY e.year, e.month`
    )
    .all();

  const byMonth = {};
  rows.forEach((r) => {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { year: r.year, month: r.month, income: 0, expense: 0 };
    byMonth[key][r.kind] = r.total;
  });

  const categoryRows = db
    .prepare(
      `SELECT e.year, e.month, c.name AS category, c.kind, SUM(e.amount) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE c.kind = 'expense'
       GROUP BY e.year, e.month, c.name
       ORDER BY e.year, e.month`
    )
    .all();

  const byCategory = {};
  categoryRows.forEach((r) => {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byCategory[r.category]) byCategory[r.category] = {};
    byCategory[r.category][key] = r.total;
  });

  res.json({
    months: Object.keys(byMonth)
      .sort()
      .map((k) => ({ key: k, ...byMonth[k] })),
    categoryTrends: byCategory
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Budget dashboard listening on port ${PORT}`);
});
