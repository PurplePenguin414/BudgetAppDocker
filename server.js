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
const WIDGET_API_KEY = process.env.WIDGET_API_KEY || null;

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
  target_payoff_date TEXT,
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
  target_amount REAL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS savings_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS retirement_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  account_type TEXT,
  goal_type TEXT CHECK(goal_type IN ('dollar','percent') OR goal_type IS NULL),
  goal_amount REAL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retirement_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES retirement_accounts(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  balance REAL NOT NULL,
  contribution REAL,
  employer_contribution REAL,
  note TEXT,
  UNIQUE(account_id, year, month)
);

CREATE TABLE IF NOT EXISTS retirement_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES retirement_accounts(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  contribution REAL,
  employer_contribution REAL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- Migration: add employer_contribution to existing installs ----------
const retirementBalCols = db.prepare("PRAGMA table_info(retirement_balances)").all().map((c) => c.name);
if (!retirementBalCols.includes('employer_contribution')) {
  db.exec('ALTER TABLE retirement_balances ADD COLUMN employer_contribution REAL');
}

// ---------- Migration: add goal-tracking columns for existing installs ----------
const savingsAllocCols = db.prepare("PRAGMA table_info(savings_allocations)").all().map((c) => c.name);
if (!savingsAllocCols.includes('target_amount')) {
  db.exec('ALTER TABLE savings_allocations ADD COLUMN target_amount REAL');
}
const retirementAcctCols = db.prepare("PRAGMA table_info(retirement_accounts)").all().map((c) => c.name);
if (!retirementAcctCols.includes('goal_type')) {
  db.exec('ALTER TABLE retirement_accounts ADD COLUMN goal_type TEXT');
}
if (!retirementAcctCols.includes('goal_amount')) {
  db.exec('ALTER TABLE retirement_accounts ADD COLUMN goal_amount REAL');
}
const debtCols = db.prepare("PRAGMA table_info(debts)").all().map((c) => c.name);
if (!debtCols.includes('target_payoff_date')) {
  db.exec('ALTER TABLE debts ADD COLUMN target_payoff_date TEXT');
}

// ---------- Migration: carry forward any old single-entry contributions into the new log ----------
const contribMigrationCheck = db.prepare('SELECT COUNT(*) AS c FROM retirement_contributions').get().c;
if (contribMigrationCheck === 0) {
  const oldRows = db
    .prepare(
      `SELECT account_id, year, month, contribution, employer_contribution
       FROM retirement_balances
       WHERE contribution IS NOT NULL OR employer_contribution IS NOT NULL`
    )
    .all();
  if (oldRows.length > 0) {
    const insertOld = db.prepare(
      'INSERT INTO retirement_contributions (account_id, year, month, contribution, employer_contribution, note) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const migrateOld = db.transaction(() => {
      oldRows.forEach((r) => {
        insertOld.run(r.account_id, r.year, r.month, r.contribution, r.employer_contribution, 'carried forward from prior single-entry log');
      });
    });
    migrateOld();
  }
}

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
    'Primary Job',
    'Side Business',
    'Freelance / Gig Work',
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
// ---------- Debts and retirement accounts start empty ----------
// These are personal, so there's no sensible default list — add your own from
// the Debt and Retirement pages using their "+ add" links.

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

// Separate, simpler auth for the mobile widget endpoint — a static API key
// passed as a query param, since a widget can't hold a browser session cookie.
function requireWidgetKey(req, res, next) {
  if (!WIDGET_API_KEY) return res.status(500).json({ error: 'Widget not configured: WIDGET_API_KEY missing' });
  if (req.query.key !== WIDGET_API_KEY) return res.status(401).json({ error: 'Invalid or missing key' });
  return next();
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

app.patch('/api/debts/:id', requireAuth, (req, res) => {
  const { target_payoff_date } = req.body;
  if (target_payoff_date !== undefined) {
    db.prepare('UPDATE debts SET target_payoff_date = ? WHERE id = ?').run(target_payoff_date || null, req.params.id);
  }
  res.json({ ok: true });
});

app.get('/api/debts/balances/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const rows = db
    .prepare(
      `SELECT d.id AS debt_id, d.name, d.target_payoff_date, b.balance, b.note
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

// ---------- Retirement accounts ----------
app.get('/api/retirement/accounts', requireAuth, (req, res) => {
  const accounts = db.prepare('SELECT * FROM retirement_accounts ORDER BY sort_order, name').all();
  res.json({ accounts });
});

app.post('/api/retirement/accounts', requireAuth, (req, res) => {
  const { name, account_type, goal_type, goal_amount } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const useGoalType = ['dollar', 'percent'].includes(goal_type) ? goal_type : null;
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM retirement_accounts').get().m;
    const info = db
      .prepare('INSERT INTO retirement_accounts (name, account_type, goal_type, goal_amount, is_default, sort_order) VALUES (?, ?, ?, ?, 0, ?)')
      .run(name.trim(), account_type || null, useGoalType, useGoalType ? (goal_amount ?? null) : null, maxOrder + 1);
    res.json({ id: info.lastInsertRowid, name: name.trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Account already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/retirement/accounts/:id', requireAuth, (req, res) => {
  const { goal_type, goal_amount } = req.body;
  if (goal_type !== undefined) {
    const useGoalType = ['dollar', 'percent'].includes(goal_type) ? goal_type : null;
    db.prepare('UPDATE retirement_accounts SET goal_type = ? WHERE id = ?').run(useGoalType, req.params.id);
    if (!useGoalType) db.prepare('UPDATE retirement_accounts SET goal_amount = NULL WHERE id = ?').run(req.params.id);
  }
  if (goal_amount !== undefined) db.prepare('UPDATE retirement_accounts SET goal_amount = ? WHERE id = ?').run(goal_amount, req.params.id);
  res.json({ ok: true });
});

app.get('/api/retirement/balances/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const rows = db
    .prepare(
      `SELECT a.id AS account_id, a.name, a.account_type, a.goal_type, a.goal_amount, b.balance, b.contribution, b.employer_contribution, b.note
       FROM retirement_accounts a
       LEFT JOIN retirement_balances b ON b.account_id = a.id AND b.year = ? AND b.month = ?
       ORDER BY a.sort_order, a.name`
    )
    .all(year, month);

  // Expected balance = last logged balance (any prior month) + this month's contributions logged so far.
  // Lets you sanity-check what you enter without doing the math yourself.
  const withExpected = rows.map((r) => {
    const prevRow = db
      .prepare(
        `SELECT balance FROM retirement_balances
         WHERE account_id = ? AND (year < ? OR (year = ? AND month < ?))
         ORDER BY year DESC, month DESC LIMIT 1`
      )
      .get(r.account_id, year, year, month);
    const contribTotals = db
      .prepare(
        `SELECT COALESCE(SUM(contribution),0) AS c, COALESCE(SUM(employer_contribution),0) AS e
         FROM retirement_contributions WHERE account_id = ? AND year = ? AND month = ?`
      )
      .get(r.account_id, year, month);
    const contributedThisMonth = (contribTotals.c || 0) + (contribTotals.e || 0);
    const expected_balance = prevRow ? prevRow.balance + contributedThisMonth : null;
    return { ...r, prev_balance: prevRow ? prevRow.balance : null, contributed_this_month: contributedThisMonth, expected_balance };
  });

  res.json({ accounts: withExpected });
});

app.post('/api/retirement/balance', requireAuth, (req, res) => {
  const { account_id, year, month, balance, contribution, employer_contribution, note } = req.body;
  if (!account_id || !year || !month || balance === undefined || balance === null) {
    return res.status(400).json({ error: 'account_id, year, month, balance are required' });
  }
  db.prepare(
    `INSERT INTO retirement_balances (account_id, year, month, balance, contribution, employer_contribution, note) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, year, month) DO UPDATE SET balance = excluded.balance, contribution = excluded.contribution, employer_contribution = excluded.employer_contribution, note = excluded.note`
  ).run(account_id, year, month, balance, contribution ?? null, employer_contribution ?? null, note || null);
  res.json({ ok: true });
});

app.get('/api/retirement/trend', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.name, b.year, b.month, b.balance
       FROM retirement_balances b JOIN retirement_accounts a ON a.id = b.account_id
       ORDER BY b.year, b.month`
    )
    .all();

  const byMonth = {};
  const byAccount = {};
  rows.forEach((r) => {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { key, total: 0 };
    byMonth[key].total += r.balance;
    if (!byAccount[r.name]) byAccount[r.name] = {};
    byAccount[r.name][key] = r.balance;
  });

  res.json({
    months: Object.keys(byMonth).sort().map((k) => byMonth[k]),
    byAccount
  });
});

// ---------- Retirement contributions (repeatable log — e.g. per paycheck) ----------
app.get('/api/retirement/contributions/:year/:month', requireAuth, (req, res) => {
  const { year, month } = req.params;
  const rows = db
    .prepare(
      `SELECT c.id, c.account_id, a.name AS account_name, c.contribution, c.employer_contribution, c.note, c.created_at
       FROM retirement_contributions c JOIN retirement_accounts a ON a.id = c.account_id
       WHERE c.year = ? AND c.month = ?
       ORDER BY c.created_at`
    )
    .all(year, month);

  const totalsByAccount = {};
  rows.forEach((r) => {
    if (!totalsByAccount[r.account_id]) totalsByAccount[r.account_id] = { contribution: 0, employer_contribution: 0 };
    totalsByAccount[r.account_id].contribution += r.contribution || 0;
    totalsByAccount[r.account_id].employer_contribution += r.employer_contribution || 0;
  });

  res.json({ entries: rows, totalsByAccount });
});

app.post('/api/retirement/contribution', requireAuth, (req, res) => {
  const { account_id, year, month, contribution, employer_contribution, note } = req.body;
  if (!account_id || !year || !month) {
    return res.status(400).json({ error: 'account_id, year, month are required' });
  }
  if ((contribution === undefined || contribution === null) && (employer_contribution === undefined || employer_contribution === null)) {
    return res.status(400).json({ error: 'at least one of contribution or employer_contribution is required' });
  }
  const info = db
    .prepare(
      'INSERT INTO retirement_contributions (account_id, year, month, contribution, employer_contribution, note) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(account_id, year, month, contribution ?? null, employer_contribution ?? null, note || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/retirement/contribution/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM retirement_contributions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Dedicated account (e.g. a debt settlement escrow account) ----------
// "Expected" balance is auto-calculated: cumulative deposits minus cumulative withdrawals,
// up through and including the selected month. "Actual" is what you manually log each month
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
      `SELECT c.id AS category_id, c.name AS category_name, c.budget_bucket, t.amount
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
  const withdrawnRow = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM savings_withdrawals`)
    .get();
  return row.total - withdrawnRow.total;
}

app.get('/api/savings/summary', requireAuth, (req, res) => {
  const totalSaved = totalSavedAllTime();
  const allocations = db.prepare('SELECT * FROM savings_allocations ORDER BY sort_order, id').all();
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  const withdrawals = db
    .prepare('SELECT * FROM savings_withdrawals ORDER BY year DESC, month DESC, created_at DESC')
    .all();
  const totalWithdrawn = withdrawals.reduce((s, w) => s + w.amount, 0);
  res.json({ totalSaved, allocations, allocated, unallocated: totalSaved - allocated, withdrawals, totalWithdrawn });
});

app.post('/api/savings/withdrawal', requireAuth, (req, res) => {
  const { year, month, amount, note } = req.body;
  if (!year || !month || amount === undefined || amount === null || amount <= 0) {
    return res.status(400).json({ error: 'year, month, and a positive amount are required' });
  }
  const info = db
    .prepare('INSERT INTO savings_withdrawals (year, month, amount, note) VALUES (?, ?, ?, ?)')
    .run(year, month, amount, note || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/savings/withdrawal/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM savings_withdrawals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/savings/allocations', requireAuth, (req, res) => {
  const { name, amount, target_amount } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM savings_allocations').get().m;
  const info = db
    .prepare('INSERT INTO savings_allocations (name, amount, target_amount, sort_order) VALUES (?, ?, ?, ?)')
    .run(name.trim(), amount || 0, target_amount ?? null, maxOrder + 1);
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/savings/allocations/:id', requireAuth, (req, res) => {
  const { amount, name, target_amount } = req.body;
  if (amount !== undefined) db.prepare('UPDATE savings_allocations SET amount = ? WHERE id = ?').run(amount, req.params.id);
  if (name !== undefined) db.prepare('UPDATE savings_allocations SET name = ? WHERE id = ?').run(name, req.params.id);
  if (target_amount !== undefined) db.prepare('UPDATE savings_allocations SET target_amount = ? WHERE id = ?').run(target_amount, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/savings/allocations/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM savings_allocations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function computeNetWorth() {
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
  return { totalSaved, dedicatedActual, totalAssets, totalDebt, netWorth: totalAssets - totalDebt };
}

app.get('/api/networth', requireAuth, (req, res) => {
  res.json(computeNetWorth());
});

// ---------- Yearly review ----------
app.get('/api/yearly/:year', requireAuth, (req, res) => {
  const { year } = req.params;

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const excludeCurrentMonth = Number(year) === curYear;
  // If viewing the current year, exclude the in-progress current month so it doesn't skew the totals.
  const monthFilter = excludeCurrentMonth ? 'e.year = ? AND e.month != ?' : 'e.year = ?';
  const monthFilterParams = excludeCurrentMonth ? [year, curMonth] : [year];

  const monthRows = excludeCurrentMonth
    ? db.prepare('SELECT DISTINCT month FROM entries WHERE year = ? AND month != ?').all(year, curMonth)
    : db.prepare('SELECT DISTINCT month FROM entries WHERE year = ?').all(year);
  const monthsTracked = monthRows.length;

  const catTotals = db
    .prepare(
      `SELECT c.name, c.kind, c.budget_bucket, SUM(e.amount) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE ${monthFilter}
       GROUP BY c.name, c.kind, c.budget_bucket
       ORDER BY total DESC`
    )
    .all(...monthFilterParams);

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
       WHERE ${monthFilter}
       GROUP BY e.month, c.kind`
    )
    .all(...monthFilterParams);
  const monthly = {};
  monthlyRows.forEach((r) => {
    if (!monthly[r.month]) monthly[r.month] = { month: r.month, income: 0, expense: 0 };
    monthly[r.month][r.kind] = r.total;
  });

  res.json({
    year: Number(year),
    monthsTracked,
    excludedCurrentMonth: excludeCurrentMonth,
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

// ---------- Mobile widget summary (current month, basic info) ----------
app.get('/api/widget/summary', requireWidgetKey, (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const entries = db
    .prepare(
      `SELECT e.amount, c.kind, c.budget_bucket
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE e.year = ? AND e.month = ?`
    )
    .all(year, month);

  const income = entries.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const net = income - expense;
  const savingsBucketAmt = entries
    .filter((e) => e.kind === 'expense' && e.budget_bucket === 'savings')
    .reduce((s, e) => s + e.amount, 0);
  const savingsRate = income > 0 ? Math.round(((net + savingsBucketAmt) / income) * 100) : 0;

  const targetRows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, t.amount AS target
       FROM categories c
       LEFT JOIN targets t ON t.category_id = c.id AND t.year = ? AND t.month = ?
       WHERE c.kind = 'expense' AND t.amount IS NOT NULL`
    )
    .all(year, month);

  const actualByCategory = {};
  db.prepare(
    `SELECT c.id AS category_id, SUM(e.amount) AS total
     FROM entries e JOIN categories c ON c.id = e.category_id
     WHERE e.year = ? AND e.month = ? AND c.kind = 'expense'
     GROUP BY c.id`
  )
    .all(year, month)
    .forEach((r) => { actualByCategory[r.category_id] = r.total; });

  const needsAttention = [];
  targetRows.forEach((t) => {
    const actual = actualByCategory[t.category_id] || 0;
    if (actual <= 0) return; // only categories with actual spending logged
    const pct = t.target > 0 ? (actual / t.target) * 100 : 0;
    let status = 'ok';
    if (pct > 100) status = 'over';
    else if (pct >= 90) status = 'near';
    needsAttention.push({ name: t.category_name, status, actual, target: t.target, pct: Math.round(pct) });
  });
  needsAttention.sort((a, b) => b.pct - a.pct);

  const counts = {
    over_target: needsAttention.filter((n) => n.status === 'over').length,
    near_target: needsAttention.filter((n) => n.status === 'near').length,
    on_track: needsAttention.filter((n) => n.status === 'ok').length
  };

  res.json({
    year,
    month,
    income,
    expense,
    net,
    savingsRate,
    counts,
    needs_attention: needsAttention
  });
});

// ---------- Mobile widget: average monthly budget ----------
app.get('/api/widget/averages', requireWidgetKey, (req, res) => {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const monthRows = db
    .prepare('SELECT DISTINCT year, month FROM entries WHERE NOT (year = ? AND month = ?)')
    .all(curYear, curMonth);
  const monthCount = monthRows.length;

  if (monthCount === 0) {
    return res.json({ monthCount: 0, avgIncome: 0, avgExpense: 0, avgNet: 0, topCategories: [] });
  }

  const catTotals = db
    .prepare(
      `SELECT c.name, c.kind, SUM(e.amount) AS total
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE NOT (e.year = ? AND e.month = ?)
       GROUP BY c.name, c.kind
       ORDER BY total DESC`
    )
    .all(curYear, curMonth);

  let totalIncome = 0;
  let totalExpense = 0;
  const expenseCategories = [];
  catTotals.forEach((r) => {
    if (r.kind === 'income') {
      totalIncome += r.total;
    } else {
      totalExpense += r.total;
      expenseCategories.push({ name: r.name, avg: r.total / monthCount });
    }
  });
  expenseCategories.sort((a, b) => b.avg - a.avg);

  res.json({
    monthCount,
    avgIncome: totalIncome / monthCount,
    avgExpense: totalExpense / monthCount,
    avgNet: (totalIncome - totalExpense) / monthCount,
    topCategories: expenseCategories.slice(0, 10)
  });
});

// ---------- Goals overview (aggregates savings/retirement/debt goal fields) ----------
app.get('/api/goals-overview', requireAuth, (req, res) => {
  const now = new Date();
  const curYear = now.getFullYear();

  // Savings allocations with a target
  const savingsGoals = db
    .prepare('SELECT id, name, amount, target_amount FROM savings_allocations WHERE target_amount IS NOT NULL ORDER BY sort_order, id')
    .all()
    .map((a) => ({
      id: a.id,
      name: a.name,
      amount: a.amount,
      target_amount: a.target_amount,
      pct: a.target_amount > 0 ? Math.min((a.amount / a.target_amount) * 100, 999) : 0
    }));

  // Retirement accounts with a goal
  const yearIncomeRow = db
    .prepare(
      `SELECT COALESCE(SUM(e.amount), 0) AS total FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE c.kind = 'income' AND e.year = ?`
    )
    .get(curYear);
  const yearIncome = yearIncomeRow.total;

  const retirementGoals = db
    .prepare('SELECT id, name, goal_type, goal_amount FROM retirement_accounts WHERE goal_type IS NOT NULL ORDER BY sort_order, name')
    .all()
    .map((a) => {
      const contribRow = db
        .prepare(
          `SELECT COALESCE(SUM(contribution), 0) AS c, COALESCE(SUM(employer_contribution), 0) AS e
           FROM retirement_contributions WHERE account_id = ? AND year = ?`
        )
        .get(a.id, curYear);
      const contributedThisYear = (contribRow.c || 0) + (contribRow.e || 0);
      const actualPctOfIncome = yearIncome > 0 ? (contributedThisYear / yearIncome) * 100 : null;
      const progressPct =
        a.goal_type === 'dollar'
          ? a.goal_amount > 0
            ? Math.min((contributedThisYear / a.goal_amount) * 100, 999)
            : 0
          : a.goal_amount > 0 && actualPctOfIncome !== null
          ? Math.min((actualPctOfIncome / a.goal_amount) * 100, 999)
          : 0;
      return {
        account_id: a.id,
        name: a.name,
        goal_type: a.goal_type,
        goal_amount: a.goal_amount,
        contributed_this_year: contributedThisYear,
        actual_pct_of_income: actualPctOfIncome,
        progress_pct: progressPct
      };
    });

  // Debts with a target payoff date
  const debtGoals = db
    .prepare('SELECT id, name, target_payoff_date FROM debts WHERE target_payoff_date IS NOT NULL ORDER BY sort_order, name')
    .all()
    .map((d) => {
      const balRows = db
        .prepare('SELECT year, month, balance FROM debt_balances WHERE debt_id = ? ORDER BY year, month')
        .all(d.id);

      if (balRows.length === 0) {
        return { debt_id: d.id, name: d.name, target_payoff_date: d.target_payoff_date, current_balance: null, status: 'no_data' };
      }

      const current_balance = balRows[balRows.length - 1].balance;
      let status = 'no_data';
      let avg_monthly_paydown = null;
      let projected_payoff_date = null;

      if (Math.round(current_balance) <= 0) {
        status = 'paid_off';
      } else if (balRows.length >= 2) {
        const first = balRows[0];
        const last = balRows[balRows.length - 1];
        const monthsSpan = (last.year - first.year) * 12 + (last.month - first.month);
        if (monthsSpan > 0) {
          avg_monthly_paydown = (first.balance - last.balance) / monthsSpan;
          if (avg_monthly_paydown > 0) {
            const monthsRemaining = current_balance / avg_monthly_paydown;
            const projDate = new Date(now.getTime());
            projDate.setMonth(projDate.getMonth() + Math.ceil(monthsRemaining));
            projected_payoff_date = projDate.toISOString().slice(0, 10);
            const targetDate = new Date(d.target_payoff_date + 'T00:00:00');
            status = projDate <= targetDate ? 'on_track' : 'behind';
          } else {
            status = 'behind';
          }
        }
      }

      return {
        debt_id: d.id,
        name: d.name,
        target_payoff_date: d.target_payoff_date,
        current_balance,
        avg_monthly_paydown,
        projected_payoff_date,
        status
      };
    });

  res.json({
    netWorth: computeNetWorth(),
    savingsGoals,
    retirementGoals,
    debtGoals
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Budget dashboard listening on port ${PORT}`);
});
