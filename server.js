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
  budget_bucket TEXT CHECK(budget_bucket IN ('needs','wants','savings') OR budget_bucket IS NULL),
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

// ---------- Migration: add budget_bucket to existing installs ----------
const existingCols = db.prepare("PRAGMA table_info(categories)").all().map((c) => c.name);
if (!existingCols.includes('budget_bucket')) {
  db.exec('ALTER TABLE categories ADD COLUMN budget_bucket TEXT');
}

// ---------- Seed default categories (only if table is empty) ----------
const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare(
    'INSERT INTO categories (kind, name, is_default, sort_order, budget_bucket) VALUES (?, ?, 1, ?, ?)'
  );
  const incomeDefaults = [
    'Taz Networks',
    'NextWave Technologies',
    'Rover',
    'The Book Bridge Organization',
    'Other'
  ];
  // [name, bucket] — bucket is null for categories excluded from 50/30/20 (e.g. business costs)
  const expenseDefaults = [
    ['Rent', 'needs'],
    ['Debt program', 'needs'],
    ['Utilities', 'needs'],
    ['Groceries', 'needs'],
    ['Fast food', 'wants'],
    ['Gas / auto', 'needs'],
    ['ATM / cash', 'wants'],
    ['Shopping', 'wants'],
    ['Subscriptions', 'wants'],
    ['Pets', 'needs'],
    ['Health', 'needs'],
    ['Business expense', null],
    ['Gaming', 'wants'],
    ['Savings / Investing', 'savings'],
    ['Other', 'wants']
  ];
  const seed = db.transaction(() => {
    incomeDefaults.forEach((name, i) => insertCat.run('income', name, i, null));
    expenseDefaults.forEach(([name, bucket], i) => insertCat.run('expense', name, i, bucket));
  });
  seed();
}

// ---------- Migration: assign buckets / add Savings category for pre-existing installs ----------
const bucketDefaults = {
  'Rent': 'needs',
  'Debt program': 'needs',
  'Utilities': 'needs',
  'Groceries': 'needs',
  'Fast food': 'wants',
  'Gas / auto': 'needs',
  'ATM / cash': 'wants',
  'Shopping': 'wants',
  'Subscriptions': 'wants',
  'Pets': 'needs',
  'Health': 'needs',
  'Health / pharmacy': 'needs',
  'Health / gym': 'needs',
  'Business expense': null,
  'Gaming': 'wants',
  'Other': 'wants'
};
const setBucket = db.prepare(
  "UPDATE categories SET budget_bucket = ? WHERE kind = 'expense' AND name = ? AND budget_bucket IS NULL"
);
const bucketMigration = db.transaction(() => {
  Object.entries(bucketDefaults).forEach(([name, bucket]) => {
    if (bucket !== null) setBucket.run(bucket, name);
  });
});
bucketMigration();

const hasSavingsCat = db
  .prepare("SELECT id FROM categories WHERE kind = 'expense' AND name = 'Savings / Investing'")
  .get();
if (!hasSavingsCat) {
  const maxOrder =
    db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE kind = 'expense'").get().m;
  db.prepare(
    "INSERT INTO categories (kind, name, is_default, sort_order, budget_bucket) VALUES ('expense', 'Savings / Investing', 1, ?, 'savings')"
  ).run(maxOrder + 1);
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
  const { kind, name, bucket } = req.body;
  if (!['income', 'expense'].includes(kind) || !name || !name.trim()) {
    return res.status(400).json({ error: 'kind must be income/expense and name required' });
  }
  const validBuckets = ['needs', 'wants', 'savings', null];
  const useBucket = kind === 'expense' ? (validBuckets.includes(bucket) ? bucket : 'wants') : null;
  try {
    const maxOrder =
      db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE kind = ?').get(kind).m;
    const info = db
      .prepare('INSERT INTO categories (kind, name, is_default, sort_order, budget_bucket) VALUES (?, ?, 0, ?, ?)')
      .run(kind, name.trim(), maxOrder + 1, useBucket);
    res.json({ id: info.lastInsertRowid, kind, name: name.trim(), budget_bucket: useBucket });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/categories/:id/bucket', requireAuth, (req, res) => {
  const { bucket } = req.body;
  if (!['needs', 'wants', 'savings', null].includes(bucket)) {
    return res.status(400).json({ error: 'bucket must be needs, wants, savings, or null' });
  }
  db.prepare('UPDATE categories SET budget_bucket = ? WHERE id = ?').run(bucket, req.params.id);
  res.json({ ok: true });
});

// ---------- Entry routes ----------
app.get('/api/month/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const entries = db
    .prepare(
      `SELECT e.id, e.amount, e.note, c.id AS category_id, c.name AS category_name, c.kind, c.budget_bucket
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

// ---------- Averages ----------
app.get('/api/averages', requireAuth, (req, res) => {
  const monthRows = db
    .prepare('SELECT DISTINCT year, month FROM entries')
    .all();
  const monthCount = monthRows.length;

  if (monthCount === 0) {
    return res.json({
      monthCount: 0,
      income: [],
      expense: [],
      totals: { avgIncome: 0, avgExpense: 0, avgNet: 0 },
      bucketAverages: { needs: 0, wants: 0, savings: 0 }
    });
  }

  const catTotals = db
    .prepare(
      `SELECT c.id, c.name, c.kind, c.budget_bucket, SUM(e.amount) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       GROUP BY c.id, c.name, c.kind, c.budget_bucket
       ORDER BY c.kind, total DESC`
    )
    .all();

  const income = [];
  const expense = [];
  const bucketAverages = { needs: 0, wants: 0, savings: 0 };
  let totalIncome = 0;
  let totalExpense = 0;

  catTotals.forEach((r) => {
    const avg = r.total / monthCount;
    if (r.kind === 'income') {
      income.push({ category: r.name, avg });
      totalIncome += r.total;
    } else {
      expense.push({ category: r.name, avg, bucket: r.budget_bucket });
      totalExpense += r.total;
      if (r.budget_bucket && bucketAverages.hasOwnProperty(r.budget_bucket)) {
        bucketAverages[r.budget_bucket] += avg;
      }
    }
  });

  res.json({
    monthCount,
    income,
    expense,
    totals: {
      avgIncome: totalIncome / monthCount,
      avgExpense: totalExpense / monthCount,
      avgNet: (totalIncome - totalExpense) / monthCount
    },
    bucketAverages
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Budget dashboard listening on port ${PORT}`);
});
