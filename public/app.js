const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1, // 1-12
  kind: 'expense',
  categories: { income: [], expense: [] },
  trendChart: null,
  categoryChart: null,
  pieChart: null
};

const PIE_COLORS = ['#2761a0','#c94235','#2a8a5f','#b87318','#7a5ea8','#c9598a','#4a9d9c','#9a8a3a','#a05e27','#6a7a3a','#8a6a8a','#3a6a8a','#a03a3a','#6a8a5a'];

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

document.getElementById('export-btn').addEventListener('click', () => {
  const wantsCsv = confirm(
    'Click OK to export as CSV (entries only, spreadsheet-friendly).\nClick Cancel to export a full JSON backup (all data, including debts and targets).'
  );
  window.location.href = wantsCsv ? '/api/export.csv' : '/api/export.json';
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

  let bucket = null;
  if (state.kind === 'expense') {
    const input = prompt('Which bucket? Type: needs, wants, or savings', 'wants');
    if (input && ['needs', 'wants', 'savings'].includes(input.trim().toLowerCase())) {
      bucket = input.trim().toLowerCase();
    } else {
      bucket = 'wants';
    }
  }

  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: state.kind, name: name.trim(), bucket })
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
  renderTargets(data.entries);
  renderMomTable(data.entries);
}

function renderSnapshot(entries) {
  const income = entries.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const net = income - expense;
  const savingsBucketAmt = entries
    .filter((e) => e.kind === 'expense' && e.budget_bucket === 'savings')
    .reduce((s, e) => s + e.amount, 0);
  // True savings rate = leftover cash + money already moved into Savings/Investing.
  // (net already subtracts savings entries as if spent, so add them back here.)
  const rate = income > 0 ? Math.round(((net + savingsBucketAmt) / income) * 100) : 0;

  document.getElementById('m-income').textContent = fmt(income);
  document.getElementById('m-expense').textContent = fmt(expense);

  const netEl = document.getElementById('m-net');
  netEl.textContent = fmt(net);
  netEl.className = 'metric-value ' + (net >= 0 ? 'v-green' : 'v-red');

  const rateEl = document.getElementById('m-rate');
  rateEl.textContent = rate + '%';
  rateEl.className = 'metric-value ' + (rate >= 10 ? 'v-green' : rate >= 0 ? 'v-amber' : 'v-red');

  renderRuleCard(entries, income);

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
  const total = sorted.reduce((s, [, amt]) => s + amt, 0);
  const rowsHtml = sorted
    .map(
      ([name, amt]) => `
    <div class="bar-row">
      <div class="bar-label">${name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(amt / max) * 100}%;background:var(--blue)"></div></div>
      <div class="bar-amt">${fmt(amt)} <span style="color:var(--muted)">(${((amt / total) * 100).toFixed(0)}%)</span></div>
    </div>`
    )
    .join('');
  const totalHtml = `
    <div class="bar-row" style="border-top:1.5px solid var(--border); padding-top:12px; margin-top:4px;">
      <div class="bar-label" style="font-weight:600;">Total</div>
      <div class="bar-track" style="visibility:hidden;"></div>
      <div class="bar-amt" style="font-weight:600;">${fmt(total)}</div>
    </div>`;
  container.innerHTML = rowsHtml + totalHtml;

  renderExpensePie(sorted);
}

function renderExpensePie(sorted) {
  const canvas = document.getElementById('expense-pie');
  if (sorted.length === 0) {
    if (state.pieChart) { state.pieChart.destroy(); state.pieChart = null; }
    return;
  }
  const total = sorted.reduce((s, [, amt]) => s + amt, 0);
  const ctx = canvas.getContext('2d');
  if (state.pieChart) state.pieChart.destroy();
  state.pieChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: sorted.map(([name, amt]) => `${name} (${((amt / total) * 100).toFixed(0)}%)`),
      datasets: [{
        data: sorted.map(([, amt]) => amt),
        backgroundColor: sorted.map((_, i) => PIE_COLORS[i % PIE_COLORS.length])
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'DM Sans', size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label.split(' (')[0]}: ${fmt(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(0)}%)`
          }
        }
      }
    }
  });
}

function renderRuleCard(entries, income) {
  const container = document.getElementById('rule-card');
  const expenseEntries = entries.filter((e) => e.kind === 'expense');
  const totals = { needs: 0, wants: 0, savings: 0 };
  expenseEntries.forEach((e) => {
    if (e.budget_bucket && totals.hasOwnProperty(e.budget_bucket)) {
      totals[e.budget_bucket] += e.amount;
    }
  });

  if (income <= 0) {
    container.innerHTML = '<div class="empty-msg">Log income for this month to see your 50/30/20 breakdown.</div>';
    return;
  }

  const buckets = [
    { key: 'needs', label: 'Needs', target: 50, color: '#2761a0' },
    { key: 'wants', label: 'Wants', target: 30, color: '#b87318' },
    { key: 'savings', label: 'Savings / investing', target: 20, color: '#2a8a5f' }
  ];

  container.innerHTML = buckets
    .map((b) => {
      const amt = totals[b.key];
      const pct = (amt / income) * 100;
      const barWidth = Math.min(pct, 100);
      const overTarget = pct > b.target + 2; // small tolerance
      const under = b.key === 'savings' && pct < b.target - 2;
      const color = overTarget || under ? '#c94235' : b.color;
      return `
      <div class="rule-row">
        <div class="rule-top">
          <span class="rule-name">${b.label}</span>
          <span class="rule-target">target ${b.target}%</span>
        </div>
        <div class="rule-track">
          <div class="rule-fill" style="width:${barWidth}%;background:${color}"></div>
          <div class="rule-marker" style="left:${b.target}%"></div>
        </div>
        <div class="rule-meta">
          <span>${fmt(amt)}</span>
          <span>${pct.toFixed(1)}% of income</span>
        </div>
      </div>`;
    })
    .join('');
}

// ---------- Bucket manager ----------
document.getElementById('manage-buckets-link').addEventListener('click', () => {
  const panel = document.getElementById('bucket-manager');
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderBucketManager();
});

function renderBucketManager() {
  const panel = document.getElementById('bucket-manager');
  const cats = state.categories.expense;
  panel.innerHTML = cats
    .map(
      (c) => `
    <div class="bucket-row">
      <span>${c.name}</span>
      <select data-id="${c.id}">
        <option value="needs" ${c.budget_bucket === 'needs' ? 'selected' : ''}>Needs</option>
        <option value="wants" ${c.budget_bucket === 'wants' ? 'selected' : ''}>Wants</option>
        <option value="savings" ${c.budget_bucket === 'savings' ? 'selected' : ''}>Savings</option>
        <option value="" ${!c.budget_bucket ? 'selected' : ''}>Excluded</option>
      </select>
    </div>`
    )
    .join('');

  panel.querySelectorAll('select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await fetch(`/api/categories/${sel.dataset.id}/bucket`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: sel.value || null })
      });
      await loadCategories();
      refreshMonth();
    });
  });
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

// ---------- Budget targets ----------
async function renderTargets(entries) {
  const container = document.getElementById('targets-card');
  const res = await fetch(`/api/targets/${state.year}/${state.month}`);
  const data = await res.json();

  const actuals = {};
  entries.filter((e) => e.kind === 'expense').forEach((e) => {
    actuals[e.category_id] = (actuals[e.category_id] || 0) + e.amount;
  });

  if (data.targets.length === 0) {
    container.innerHTML = '<div class="empty-msg">No expense categories yet.</div>';
    return;
  }

  let totalTarget = 0;
  let totalActual = 0;
  data.targets.forEach((t) => {
    if (t.amount) totalTarget += t.amount;
    totalActual += actuals[t.category_id] || 0;
  });
  const totalOver = totalTarget > 0 && totalActual > totalTarget;

  const rowsHtml = data.targets
    .map((t) => {
      const actual = actuals[t.category_id] || 0;
      const target = t.amount;
      const pct = target ? Math.min((actual / target) * 100, 100) : 0;
      const over = target && actual > target;
      const color = !target ? 'var(--surface2)' : over ? 'var(--red)' : 'var(--blue)';
      return `
      <div class="target-row">
        <div class="target-name">${t.category_name}</div>
        <div class="target-track"><div class="target-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="target-actual" style="color:${over ? 'var(--red)' : 'var(--text)'}">${fmt(actual)}</div>
        <div class="target-input-wrap">
          <span>of $</span>
          <input type="number" step="0.01" min="0" data-category-id="${t.category_id}" value="${target !== null ? target : ''}" placeholder="—" />
        </div>
      </div>`;
    })
    .join('');

  const totalHtml = `
    <div class="target-row" style="border-bottom:none; padding-top:12px; margin-top:4px; border-top:1.5px solid var(--border);">
      <div class="target-name" style="font-weight:600;">Total</div>
      <div class="target-track" style="visibility:hidden;"></div>
      <div class="target-actual" style="font-weight:600; color:${totalOver ? 'var(--red)' : 'var(--text)'}">${fmt(totalActual)}</div>
      <div class="target-input-wrap"><span>of ${fmt(totalTarget)}</span></div>
    </div>`;

  container.innerHTML = rowsHtml + totalHtml;

  container.querySelectorAll('.target-input-wrap input').forEach((input) => {
    input.addEventListener('change', async () => {
      const amount = parseFloat(input.value);
      if (isNaN(amount) || amount < 0) return;
      await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: input.dataset.categoryId, year: state.year, month: state.month, amount })
      });
      refreshMonth();
    });
  });
}

// ---------- Month over month ----------
async function renderMomTable(currentEntries) {
  const container = document.getElementById('mom-table');
  let prevYear = state.year;
  let prevMonth = state.month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear--; }

  const res = await fetch(`/api/month/${prevYear}/${prevMonth}`);
  const prevData = await res.json();

  const curTotals = {};
  currentEntries.forEach((e) => {
    const key = e.category_name + '|' + e.kind;
    curTotals[key] = (curTotals[key] || 0) + e.amount;
  });
  const prevTotals = {};
  prevData.entries.forEach((e) => {
    const key = e.category_name + '|' + e.kind;
    prevTotals[key] = (prevTotals[key] || 0) + e.amount;
  });

  const allKeys = Array.from(new Set([...Object.keys(curTotals), ...Object.keys(prevTotals)]));
  if (allKeys.length === 0) {
    container.innerHTML = '<div class="empty-msg">Not enough data yet — log entries in both months to compare.</div>';
    return;
  }

  const rows = allKeys
    .map((key) => {
      const [name, kind] = key.split('|');
      const cur = curTotals[key] || 0;
      const prev = prevTotals[key] || 0;
      let changeLabel = '—';
      let color = 'var(--muted)';
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        changeLabel = (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%';
        const improved = kind === 'income' ? pct >= 0 : pct <= 0;
        color = pct === 0 ? 'var(--muted)' : improved ? 'var(--green)' : 'var(--red)';
      } else if (cur > 0) {
        changeLabel = 'new';
        color = 'var(--muted)';
      }
      return { name, kind, cur, prev, changeLabel, color };
    })
    .sort((a, b) => b.cur - a.cur);

  container.innerHTML = `
    <table class="mom">
      <thead>
        <tr><th>Category</th><th style="text-align:right">This month</th><th style="text-align:right">Last month</th><th style="text-align:right">Change</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
        <tr>
          <td>${r.name}</td>
          <td class="num">${fmt(r.cur)}</td>
          <td class="num">${fmt(r.prev)}</td>
          <td class="num" style="color:${r.color}">${r.changeLabel}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
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

  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (state.trendChart) state.trendChart.destroy();
  state.trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: income,
          borderColor: '#2a8a5f',
          backgroundColor: 'rgba(42,138,95,0.18)',
          fill: true,
          tension: 0.25
        },
        {
          label: 'Expenses',
          data: expense,
          borderColor: '#c94235',
          backgroundColor: 'rgba(201,66,53,0.18)',
          fill: true,
          tension: 0.25
        }
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
