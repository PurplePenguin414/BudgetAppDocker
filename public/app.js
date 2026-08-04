const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1, // 1-12
  kind: 'expense',
  categories: { income: [], expense: [] },
  trendChart: null,
  categoryChart: null
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// ---------- Auth ----------
async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (data.loggedIn) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    await init();
  } else {
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('app').style.display = 'none';
  }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const password = document.getElementById('login-password').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (res.ok) {
    document.getElementById('login-error').textContent = '';
    checkSession();
  } else {
    document.getElementById('login-error').textContent = 'Incorrect password.';
  }
});

document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  checkSession();
});

// ---------- Month nav ----------
document.getElementById('prev-month').addEventListener('click', () => {
  state.month--;
  if (state.month < 1) { state.month = 12; state.year--; }
  refreshMonth();
});
document.getElementById('next-month').addEventListener('click', () => {
  state.month++;
  if (state.month > 12) { state.month = 1; state.year++; }
  refreshMonth();
});

function renderMonthLabel() {
  document.getElementById('month-label').textContent = `${MONTH_NAMES[state.month - 1]} ${state.year}`;
}

// ---------- Kind toggle ----------
document.getElementById('toggle-expense').addEventListener('click', () => setKind('expense'));
document.getElementById('toggle-income').addEventListener('click', () => setKind('income'));

function setKind(kind) {
  state.kind = kind;
  document.getElementById('toggle-expense').classList.toggle('active', kind === 'expense');
  document.getElementById('toggle-income').classList.toggle('active', kind === 'income');
  populateCategorySelect();
}

function populateCategorySelect() {
  const sel = document.getElementById('entry-category');
  sel.innerHTML = '';
  state.categories[state.kind].forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

// ---------- Add category ----------
document.getElementById('add-cat-link').addEventListener('click', async () => {
  const name = prompt(`New ${state.kind} category name:`);
  if (!name || !name.trim()) return;
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: state.kind, name: name.trim() })
  });
  if (res.ok) {
    await loadCategories();
    populateCategorySelect();
  } else {
    const err = await res.json();
    alert(err.error || 'Could not add category');
  }
});

// ---------- Entry submit ----------
document.getElementById('entry-submit').addEventListener('click', async () => {
  const category_id = document.getElementById('entry-category').value;
  const amount = parseFloat(document.getElementById('entry-amount').value);
  const note = document.getElementById('entry-note').value;
  if (!category_id || isNaN(amount) || amount <= 0) {
    alert('Pick a category and enter an amount greater than 0.');
    return;
  }
  await fetch('/api/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: state.year, month: state.month, category_id, amount, note })
  });
  document.getElementById('entry-amount').value = '';
  document.getElementById('entry-note').value = '';
  refreshMonth();
  loadTrends();
});

// ---------- Data loading ----------
async function loadCategories() {
  const res = await fetch('/api/categories');
  state.categories = await res.json();
}

async function refreshMonth() {
  renderMonthLabel();
  const res = await fetch(`/api/month/${state.year}/${state.month}`);
  const data = await res.json();
  renderSnapshot(data.entries);
  renderEntryList(data.entries);
}

function renderSnapshot(entries) {
  const income = entries.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const net = income - expense;
  const rate = income > 0 ? Math.round((net / income) * 100) : 0;

  document.getElementById('m-income').textContent = fmt(income);
  document.getElementById('m-expense').textContent = fmt(expense);

  const netEl = document.getElementById('m-net');
  netEl.textContent = fmt(net);
  netEl.className = 'metric-value ' + (net >= 0 ? 'v-green' : 'v-red');

  const rateEl = document.getElementById('m-rate');
  rateEl.textContent = rate + '%';
  rateEl.className = 'metric-value ' + (rate >= 10 ? 'v-green' : rate >= 0 ? 'v-amber' : 'v-red');

  // Category bars (expenses only)
  const byCat = {};
  entries.filter((e) => e.kind === 'expense').forEach((e) => {
    byCat[e.category_name] = (byCat[e.category_name] || 0) + e.amount;
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const container = document.getElementById('expense-bars');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-msg">No expenses logged yet for this month.</div>';
    return;
  }
  const max = sorted[0][1];
  container.innerHTML = sorted
    .map(
      ([name, amt]) => `
    <div class="bar-row">
      <div class="bar-label">${name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(amt / max) * 100}%;background:var(--blue)"></div></div>
      <div class="bar-amt">${fmt(amt)}</div>
    </div>`
    )
    .join('');
}

function renderEntryList(entries) {
  const list = document.getElementById('entry-list');
  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-msg">Nothing logged yet.</div>';
    return;
  }
  list.innerHTML = entries
    .map(
      (e) => `
    <div class="erow">
      <div>
        <span class="ecat">${e.category_name}</span>
        ${e.note ? `<span class="enote">${e.note}</span>` : ''}
      </div>
      <div>
        <span class="eamt" style="color:${e.kind === 'income' ? 'var(--green)' : 'var(--text)'}">
          ${e.kind === 'income' ? '+' : '−'}${fmt(e.amount)}
        </span>
        <button class="edel" data-id="${e.id}">delete</button>
      </div>
    </div>`
    )
    .join('');

  list.querySelectorAll('.edel').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/entry/${btn.dataset.id}`, { method: 'DELETE' });
      refreshMonth();
      loadTrends();
    });
  });
}

// ---------- Trends ----------
async function loadTrends() {
  const res = await fetch('/api/trends');
  const data = await res.json();
  renderTrendChart(data.months);
  renderCategorySelect(data.categoryTrends);
}

function renderTrendChart(months) {
  const labels = months.map((m) => `${MONTH_NAMES[m.month - 1].slice(0, 3)} ${String(m.year).slice(2)}`);
  const income = months.map((m) => m.income || 0);
  const expense = months.map((m) => m.expense || 0);
  const net = months.map((m) => (m.income || 0) - (m.expense || 0));

  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (state.trendChart) state.trendChart.destroy();
  state.trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: income, borderColor: '#2a8a5f', backgroundColor: 'transparent', tension: 0.25 },
        { label: 'Expenses', data: expense, borderColor: '#c94235', backgroundColor: 'transparent', tension: 0.25 },
        { label: 'Net', data: net, borderColor: '#2761a0', backgroundColor: 'transparent', borderDash: [4, 3], tension: 0.25 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { font: { family: 'DM Sans', size: 11 } } } },
      scales: {
        y: { ticks: { callback: (v) => '$' + v } },
        x: { ticks: { font: { family: 'DM Mono', size: 10 } } }
      }
    }
  });
}

function renderCategorySelect(categoryTrends) {
  const sel = document.getElementById('cat-trend-select');
  const names = Object.keys(categoryTrends);
  const prev = sel.value;
  sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join('');
  if (names.length === 0) {
    document.getElementById('category-chart').style.display = 'none';
    return;
  }
  document.getElementById('category-chart').style.display = 'block';
  sel.value = names.includes(prev) ? prev : names[0];
  renderCategoryChart(categoryTrends, sel.value);

  sel.onchange = () => renderCategoryChart(categoryTrends, sel.value);
}

function renderCategoryChart(categoryTrends, categoryName) {
  const monthMap = categoryTrends[categoryName] || {};
  const keys = Object.keys(monthMap).sort();
  const labels = keys.map((k) => {
    const [y, m] = k.split('-');
    return `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
  });
  const values = keys.map((k) => monthMap[k]);

  const ctx = document.getElementById('category-chart').getContext('2d');
  if (state.categoryChart) state.categoryChart.destroy();
  state.categoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: categoryName, data: values, backgroundColor: '#2761a0' }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v) => '$' + v } } }
    }
  });
}

// ---------- Init ----------
async function init() {
  await loadCategories();
  populateCategorySelect();
  await refreshMonth();
  await loadTrends();
}

checkSession();
