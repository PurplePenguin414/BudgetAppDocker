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

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS debt_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  balance REAL NOT NULL,
  note TEXT,
  UNIQUE(debt_id, year, month)
);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  amount REAL NOT NULL,
  UNIQUE(category_id, year, month)
);

CREATE TABLE IF NOT EXISTS category_goals (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id),
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS dedicated_account_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  expected REAL,
  actual REAL,
  UNIQUE(year, month)
);

CREATE TABLE IF NOT EXISTS dedicated_account_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dedicated_account_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS savings_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL,
  schedule_type TEXT NOT NULL DEFAULT 'cycle' CHECK(schedule_type IN ('cycle','fixed_day')),
  cycle_days INTEGER NOT NULL DEFAULT 30,
  fixed_day INTEGER,
  last_charged_date TEXT,
  category TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- Migration: add schedule_type/fixed_day to existing installs ----------
const billCols = db.prepare("PRAGMA table_info(bills)").all().map((c) => c.name);
if (!billCols.includes('schedule_type')) {
  db.exec("ALTER TABLE bills ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'cycle'");
}
if (!billCols.includes('fixed_day')) {
  db.exec('ALTER TABLE bills ADD COLUMN fixed_day INTEGER');
}
if (!billCols.includes('category')) {
  db.exec('ALTER TABLE bills ADD COLUMN category TEXT');
}

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

// ---------- Seed default debts (only if table is empty) ----------
const debtCount = db.prepare('SELECT COUNT(*) AS c FROM debts').get().c;
if (debtCount === 0) {
  const insertDebt = db.prepare(
    'INSERT INTO debts (name, is_default, sort_order) VALUES (?, 1, ?)'
  );
  const debtDefaults = ['Discover', 'PNC Bank', 'Citi Bank', 'Capital One'];
  const seedDebts = db.transaction(() => {
    debtDefaults.forEach((name, i) => insertDebt.run(name, i));
  });
  seedDebts();
}

// ---------- Migration: rename old debt labels, add Citi Bank for pre-existing installs ----------
const debtRenames = {
  'PNC (BeyondFinance)': 'PNC Bank',
  'Discover (BeyondFinance)': 'Discover'
};
const renameDebt = db.prepare('UPDATE debts SET name = ? WHERE name = ?');
const debtRenameMigration = db.transaction(() => {
  Object.entries(debtRenames).forEach(([oldName, newName]) => {
    const exists = db.prepare('SELECT id FROM debts WHERE name = ?').get(oldName);
    const newExists = db.prepare('SELECT id FROM debts WHERE name = ?').get(newName);
    if (exists && !newExists) renameDebt.run(newName, oldName);
  });
});
debtRenameMigration();

const hasCitiBank = db.prepare("SELECT id FROM debts WHERE name = 'Citi Bank'").get();
if (!hasCitiBank) {
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM debts').get().m;
  db.prepare('INSERT INTO debts (name, is_default, sort_order) VALUES (?, 1, ?)').run('Citi Bank', maxOrder + 1);
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
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const monthRows = db
    .prepare('SELECT DISTINCT year, month FROM entries WHERE NOT (year = ? AND month = ?)')
    .all(curYear, curMonth);
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
       WHERE NOT (e.year = ? AND e.month = ?)
       GROUP BY c.id, c.name, c.kind, c.budget_bucket
       ORDER BY c.kind, total DESC`
    )
    .all(curYear, curMonth);

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

// ---------- Debt tracker ----------
app.get('/api/debts', requireAuth, (req, res) => {
  const debts = db.prepare('SELECT * FROM debts ORDER BY sort_order, name').all();
  res.json({ debts });
});

app.post('/api/debts', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM debts').get().m;
    const info = db
      .prepare('INSERT INTO debts (name, is_default, sort_order) VALUES (?, 0, ?)')
      .run(name.trim(), maxOrder + 1);
    res.json({ id: info.lastInsertRowid, name: name.trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Debt already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/debts/balances/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const rows = db
    .prepare(
      `SELECT d.id AS debt_id, d.name, b.balance, b.note
       FROM debts d
       LEFT JOIN debt_balances b ON b.debt_id = d.id AND b.year = ? AND b.month = ?
       ORDER BY d.sort_order, d.name`
    )
    .all(year, month);
  res.json({ debts: rows });
});

app.post('/api/debts/balance', requireAuth, (req, res) => {
  const { debt_id, year, month, balance, note } = req.body;
  if (!debt_id || !year || !month || balance === undefined || balance === null) {
    return res.status(400).json({ error: 'debt_id, year, month, balance are required' });
  }
  db.prepare(
    `INSERT INTO debt_balances (debt_id, year, month, balance, note) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(debt_id, year, month) DO UPDATE SET balance = excluded.balance, note = excluded.note`
  ).run(debt_id, year, month, balance, note || null);
  res.json({ ok: true });
});

app.get('/api/debts/trend', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.name, b.year, b.month, b.balance
       FROM debt_balances b JOIN debts d ON d.id = b.debt_id
       ORDER BY b.year, b.month`
    )
    .all();

  const byMonth = {};
  const byDebt = {};
  rows.forEach((r) => {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { key, total: 0 };
    byMonth[key].total += r.balance;
    if (!byDebt[r.name]) byDebt[r.name] = {};
    byDebt[r.name][key] = r.balance;
  });

  res.json({
    months: Object.keys(byMonth).sort().map((k) => byMonth[k]),
    byDebt
  });
});

// ---------- Dedicated account (BeyondFinance settlement fund) ----------
// "Expected" balance is auto-calculated: cumulative deposits minus cumulative withdrawals,
// up through and including the selected month. "Actual" is what Megan manually logs each month
// after checking the real account, so she can see if they've drifted apart.

function cumulativeThrough(table, year, month) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${table}
       WHERE year < ? OR (year = ? AND month <= ?)`
    )
    .get(year, year, month);
  return row.total;
}

app.get('/api/dedicated/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const balance = db
    .prepare('SELECT actual FROM dedicated_account_balances WHERE year = ? AND month = ?')
    .get(year, month);
  const deposits = db
    .prepare('SELECT id, amount, note, created_at FROM dedicated_account_deposits WHERE year = ? AND month = ? ORDER BY created_at')
    .all(year, month);
  const withdrawals = db
    .prepare('SELECT id, amount, note, created_at FROM dedicated_account_withdrawals WHERE year = ? AND month = ? ORDER BY created_at')
    .all(year, month);

  const depositTotal = cumulativeThrough('dedicated_account_deposits', year, month);
  const withdrawalTotal = cumulativeThrough('dedicated_account_withdrawals', year, month);

  res.json({
    actual: balance ? balance.actual : null,
    expectedCumulative: depositTotal - withdrawalTotal,
    deposits,
    withdrawals
  });
});

app.post('/api/dedicated/balance', requireAuth, (req, res) => {
  const { year, month, actual } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
  db.prepare(
    `INSERT INTO dedicated_account_balances (year, month, actual) VALUES (?, ?, ?)
     ON CONFLICT(year, month) DO UPDATE SET actual = excluded.actual`
  ).run(year, month, actual ?? null);
  res.json({ ok: true });
});

app.post('/api/dedicated/deposit', requireAuth, (req, res) => {
  const { year, month, amount, note } = req.body;
  if (!year || !month || amount === undefined || amount === null) {
    return res.status(400).json({ error: 'year, month, amount are required' });
  }
  const info = db
    .prepare('INSERT INTO dedicated_account_deposits (year, month, amount, note) VALUES (?, ?, ?, ?)')
    .run(year, month, amount, note || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/dedicated/deposit/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM dedicated_account_deposits WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/dedicated/withdrawal', requireAuth, (req, res) => {
  const { year, month, amount, note } = req.body;
  if (!year || !month || amount === undefined || amount === null) {
    return res.status(400).json({ error: 'year, month, amount are required' });
  }
  const info = db
    .prepare('INSERT INTO dedicated_account_withdrawals (year, month, amount, note) VALUES (?, ?, ?, ?)')
    .run(year, month, amount, note || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/dedicated/withdrawal/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM dedicated_account_withdrawals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/dedicated/trend', requireAuth, (req, res) => {
  const balanceRows = db.prepare('SELECT year, month, actual FROM dedicated_account_balances').all();
  const depositRows = db.prepare('SELECT year, month, amount FROM dedicated_account_deposits').all();
  const withdrawalRows = db.prepare('SELECT year, month, amount FROM dedicated_account_withdrawals').all();

  const keyOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const allKeys = new Set();
  balanceRows.forEach((r) => allKeys.add(keyOf(r.year, r.month)));
  depositRows.forEach((r) => allKeys.add(keyOf(r.year, r.month)));
  withdrawalRows.forEach((r) => allKeys.add(keyOf(r.year, r.month)));

  const sortedKeys = Array.from(allKeys).sort();
  const actualByKey = {};
  balanceRows.forEach((r) => { actualByKey[keyOf(r.year, r.month)] = r.actual; });

  const months = sortedKeys.map((key) => {
    const [y, m] = key.split('-').map(Number);
    const depositTotal = cumulativeThrough('dedicated_account_deposits', y, m);
    const withdrawalTotal = cumulativeThrough('dedicated_account_withdrawals', y, m);
    return {
      key,
      expected: depositTotal - withdrawalTotal,
      actual: actualByKey[key] !== undefined ? actualByKey[key] : null
    };
  });

  res.json({ months });
});

// ---------- Budget targets ----------
app.get('/api/targets/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const rows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, t.amount
       FROM categories c
       LEFT JOIN targets t ON t.category_id = c.id AND t.year = ? AND t.month = ?
       WHERE c.kind = 'expense'
       ORDER BY c.sort_order, c.name`
    )
    .all(year, month);
  res.json({ targets: rows });
});

app.post('/api/targets', requireAuth, (req, res) => {
  const { category_id, year, month, amount } = req.body;
  if (!category_id || !year || !month || amount === undefined || amount === null) {
    return res.status(400).json({ error: 'category_id, year, month, amount are required' });
  }
  db.prepare(
    `INSERT INTO targets (category_id, year, month, amount) VALUES (?, ?, ?, ?)
     ON CONFLICT(category_id, year, month) DO UPDATE SET amount = excluded.amount`
  ).run(category_id, year, month, amount);
  res.json({ ok: true });
});

// ---------- Category goals (blanket, non-monthly — used on Averages page) ----------
app.get('/api/goals', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, g.amount
       FROM categories c
       LEFT JOIN category_goals g ON g.category_id = c.id
       WHERE c.kind = 'expense'
       ORDER BY c.sort_order, c.name`
    )
    .all();
  res.json({ goals: rows });
});

app.post('/api/goals', requireAuth, (req, res) => {
  const { category_id, amount } = req.body;
  if (!category_id || amount === undefined || amount === null) {
    return res.status(400).json({ error: 'category_id and amount are required' });
  }
  db.prepare(
    `INSERT INTO category_goals (category_id, amount) VALUES (?, ?)
     ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount`
  ).run(category_id, amount);
  res.json({ ok: true });
});

// ---------- Export ----------
app.get('/api/export.json', requireAuth, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY kind, sort_order').all();
  const entries = db
    .prepare(
      `SELECT e.year, e.month, c.kind, c.name AS category, e.amount, e.note
       FROM entries e JOIN categories c ON c.id = e.category_id
       ORDER BY e.year, e.month, c.kind`
    )
    .all();
  const debts = db.prepare('SELECT * FROM debts ORDER BY sort_order').all();
  const debtBalances = db
    .prepare(
      `SELECT d.name AS debt, b.year, b.month, b.balance, b.note
       FROM debt_balances b JOIN debts d ON d.id = b.debt_id
       ORDER BY b.year, b.month`
    )
    .all();
  const targets = db
    .prepare(
      `SELECT c.name AS category, t.year, t.month, t.amount
       FROM targets t JOIN categories c ON c.id = t.category_id
       ORDER BY t.year, t.month`
    )
    .all();

  res.setHeader('Content-Disposition', 'attachment; filename="budget-dashboard-export.json"');
  res.json({
    exported_at: new Date().toISOString(),
    categories,
    entries,
    debts,
    debtBalances,
    targets
  });
});

app.get('/api/export.csv', requireAuth, (req, res) => {
  const entries = db
    .prepare(
      `SELECT e.year, e.month, c.kind, c.name AS category, e.amount, e.note
       FROM entries e JOIN categories c ON c.id = e.category_id
       ORDER BY e.year, e.month, c.kind, c.name`
    )
    .all();

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = 'Year,Month,Type,Category,Amount,Note';
  const rows = entries.map((e) =>
    [e.year, e.month, e.kind, e.category, e.amount, e.note].map(escapeCsv).join(',')
  );
  const csv = [header, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="budget-dashboard-entries.csv"');
  res.send(csv);
});

// ---------- Savings allocations & net worth ----------
function totalSavedAllTime() {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(e.amount), 0) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE c.budget_bucket = 'savings'`
    )
    .get();
  return row.total;
}

app.get('/api/savings/summary', requireAuth, (req, res) => {
  const totalSaved = totalSavedAllTime();
  const allocations = db.prepare('SELECT * FROM savings_allocations ORDER BY sort_order, id').all();
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  res.json({ totalSaved, allocations, allocated, unallocated: totalSaved - allocated });
});

app.post('/api/savings/allocations', requireAuth, (req, res) => {
  const { name, amount } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM savings_allocations').get().m;
  const info = db
    .prepare('INSERT INTO savings_allocations (name, amount, sort_order) VALUES (?, ?, ?)')
    .run(name.trim(), amount || 0, maxOrder + 1);
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/savings/allocations/:id', requireAuth, (req, res) => {
  const { amount, name } = req.body;
  if (amount !== undefined) db.prepare('UPDATE savings_allocations SET amount = ? WHERE id = ?').run(amount, req.params.id);
  if (name !== undefined) db.prepare('UPDATE savings_allocations SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/savings/allocations/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM savings_allocations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/networth', requireAuth, (req, res) => {
  const totalSaved = totalSavedAllTime();

  const dedicatedRow = db
    .prepare('SELECT actual FROM dedicated_account_balances WHERE actual IS NOT NULL ORDER BY year DESC, month DESC LIMIT 1')
    .get();
  const dedicatedActual = dedicatedRow ? dedicatedRow.actual : 0;

  const debts = db.prepare('SELECT id, name FROM debts').all();
  let totalDebt = 0;
  debts.forEach((d) => {
    const latest = db
      .prepare('SELECT balance FROM debt_balances WHERE debt_id = ? ORDER BY year DESC, month DESC LIMIT 1')
      .get(d.id);
    if (latest) totalDebt += latest.balance;
  });

  const totalAssets = totalSaved + dedicatedActual;
  res.json({
    totalSaved,
    dedicatedActual,
    totalAssets,
    totalDebt,
    netWorth: totalAssets - totalDebt
  });
});

// ---------- Yearly review ----------
app.get('/api/yearly/:year', requireAuth, (req, res) => {
  const { year } = req.params;

  const monthRows = db.prepare('SELECT DISTINCT month FROM entries WHERE year = ?').all(year);
  const monthsTracked = monthRows.length;

  const catTotals = db
    .prepare(
      `SELECT c.name, c.kind, c.budget_bucket, SUM(e.amount) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE e.year = ?
       GROUP BY c.name, c.kind, c.budget_bucket
       ORDER BY total DESC`
    )
    .all(year);

  let income = 0;
  let expense = 0;
  const bucketTotals = { needs: 0, wants: 0, savings: 0 };
  const topExpenseCategories = [];
  catTotals.forEach((r) => {
    if (r.kind === 'income') {
      income += r.total;
    } else {
      expense += r.total;
      topExpenseCategories.push({ category: r.name, total: r.total });
      if (r.budget_bucket && bucketTotals.hasOwnProperty(r.budget_bucket)) {
        bucketTotals[r.budget_bucket] += r.total;
      }
    }
  });
  const net = income - expense;

  const monthlyRows = db
    .prepare(
      `SELECT e.month, c.kind, SUM(e.amount) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE e.year = ?
       GROUP BY e.month, c.kind`
    )
    .all(year);
  const monthly = {};
  monthlyRows.forEach((r) => {
    if (!monthly[r.month]) monthly[r.month] = { month: r.month, income: 0, expense: 0 };
    monthly[r.month][r.kind] = r.total;
  });

  res.json({
    year: Number(year),
    monthsTracked,
    income,
    expense,
    net,
    savingsRate: income > 0 ? ((net + bucketTotals.savings) / income) * 100 : 0,
    bucketTotals,
    topExpenseCategories: topExpenseCategories.sort((a, b) => b.total - a.total),
    monthly: Object.values(monthly).sort((a, b) => a.month - b.month)
  });
});

app.get('/api/yearly-list', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT DISTINCT year FROM entries ORDER BY year DESC').all();
  res.json({ years: rows.map((r) => r.year) });
});

// ---------- Bills / subscriptions ----------
function clampDayToMonth(year, monthIndex, day) {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(day, lastDayOfMonth);
}

function computeBillDueInfo(bill) {
  const today = new Date(new Date().toDateString());

  if (bill.schedule_type === 'fixed_day' && bill.fixed_day) {
    const year = today.getFullYear();
    const monthIndex = today.getMonth();
    let candidate = new Date(year, monthIndex, clampDayToMonth(year, monthIndex, bill.fixed_day));
    if (candidate < today) {
      candidate = new Date(year, monthIndex + 1, clampDayToMonth(year, monthIndex + 1, bill.fixed_day));
    }
    const days_until = Math.round((candidate.getTime() - today.getTime()) / 86400000);
    return { next_due_date: candidate.toISOString().slice(0, 10), days_until };
  }

  if (!bill.last_charged_date) {
    return { next_due_date: null, days_until: null };
  }
  const last = new Date(bill.last_charged_date + 'T00:00:00');
  const next = new Date(last.getTime() + bill.cycle_days * 86400000);
  const days_until = Math.round((next.getTime() - today.getTime()) / 86400000);
  return { next_due_date: next.toISOString().slice(0, 10), days_until };
}

app.get('/api/bills', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM bills ORDER BY sort_order, id').all();
  const withDue = rows.map((b) => ({ ...b, ...computeBillDueInfo(b) }));
  withDue.sort((a, b) => {
    if (a.days_until === null) return 1;
    if (b.days_until === null) return -1;
    return a.days_until - b.days_until;
  });
  res.json({ bills: withDue });
});

app.post('/api/bills', requireAuth, (req, res) => {
  const { name, amount, schedule_type, cycle_days, fixed_day, last_charged_date, category, note } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const useType = schedule_type === 'fixed_day' ? 'fixed_day' : 'cycle';
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM bills').get().m;
  const info = db
    .prepare('INSERT INTO bills (name, amount, schedule_type, cycle_days, fixed_day, last_charged_date, category, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), amount || null, useType, cycle_days || 30, fixed_day || null, last_charged_date || null, category || null, note || null, maxOrder + 1);
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/bills/:id', requireAuth, (req, res) => {
  const { name, amount, schedule_type, cycle_days, fixed_day, last_charged_date, category, note } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (amount !== undefined) { fields.push('amount = ?'); values.push(amount); }
  if (schedule_type !== undefined) { fields.push('schedule_type = ?'); values.push(schedule_type); }
  if (cycle_days !== undefined) { fields.push('cycle_days = ?'); values.push(cycle_days); }
  if (fixed_day !== undefined) { fields.push('fixed_day = ?'); values.push(fixed_day); }
  if (last_charged_date !== undefined) { fields.push('last_charged_date = ?'); values.push(last_charged_date); }
  if (category !== undefined) { fields.push('category = ?'); values.push(category); }
  if (note !== undefined) { fields.push('note = ?'); values.push(note); }
  if (fields.length === 0) return res.json({ ok: true });
  values.push(req.params.id);
  db.prepare(`UPDATE bills SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

app.patch('/api/bills/:id/charged', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE bills SET last_charged_date = ? WHERE id = ?').run(today, req.params.id);
  res.json({ ok: true, last_charged_date: today });
});

app.delete('/api/bills/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bills WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Budget dashboard listening on port ${PORT}`);
});
