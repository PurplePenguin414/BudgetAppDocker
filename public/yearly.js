const state = { year: new Date().getFullYear(), chart: null };
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.loggedIn) {
    window.location.href = 'index.html';
    return;
  }
  init();
}

document.getElementById('prev-year').addEventListener('click', () => {
  state.year--;
  load();
});
document.getElementById('next-year').addEventListener('click', () => {
  state.year++;
  load();
});

async function load() {
  document.getElementById('year-label').textContent = state.year;
  const res = await fetch(`/api/yearly/${state.year}`);
  const data = await res.json();

  if (data.monthsTracked === 0) {
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('content').style.display = 'none';
    return;
  }

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('content').style.display = 'block';
  document.getElementById('y-months-label').textContent =
    `${data.monthsTracked} month${data.monthsTracked === 1 ? '' : 's'} logged this year` +
    (data.excludedCurrentMonth ? ' (current month excluded)' : '');

  document.getElementById('y-income').textContent = fmt(data.income);
  document.getElementById('y-expense').textContent = fmt(data.expense);

  const netEl = document.getElementById('y-net');
  netEl.textContent = fmt(data.net);
  netEl.className = 'metric-value ' + (data.net >= 0 ? 'v-green' : 'v-red');

  const rate = Math.round(data.savingsRate);
  const rateEl = document.getElementById('y-rate');
  rateEl.textContent = rate + '%';
  rateEl.className = 'metric-value ' + (rate >= 10 ? 'v-green' : rate >= 0 ? 'v-amber' : 'v-red');

  renderRuleCard(data.bucketTotals, data.income);
  renderTopCategories(data.topExpenseCategories, data.expense);
  renderYearChart(data.monthly);
  renderMonthlyTable(data.monthly);
}

function renderRuleCard(bucketTotals, income) {
  const container = document.getElementById('rule-card');
  if (income <= 0) {
    container.innerHTML = '<div class="empty-msg">No income logged this year.</div>';
    return;
  }
  const buckets = [
    { key: 'needs', label: 'Needs', target: 50, color: '#2761a0' },
    { key: 'wants', label: 'Wants', target: 30, color: '#b87318' },
    { key: 'savings', label: 'Savings / investing', target: 20, color: '#2a8a5f' }
  ];
  container.innerHTML = buckets
    .map((b) => {
      const amt = bucketTotals[b.key] || 0;
      const pct = (amt / income) * 100;
      const barWidth = Math.min(pct, 100);
      const overTarget = pct > b.target + 2;
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

function renderTopCategories(categories, totalExpense) {
  const container = document.getElementById('top-categories');
  if (categories.length === 0) {
    container.innerHTML = '<div class="empty-msg">No expenses logged this year.</div>';
    return;
  }
  const max = categories[0].total;
  const rowsHtml = categories
    .slice(0, 10)
    .map(
      (c) => `
    <div class="bar-row">
      <div class="bar-label">${c.category}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(c.total / max) * 100}%;background:var(--blue)"></div></div>
      <div class="bar-amt">${fmt(c.total)} <span style="color:var(--muted)">(${((c.total / totalExpense) * 100).toFixed(0)}%)</span></div>
    </div>`
    )
    .join('');
  const totalHtml = `
    <div class="bar-row" style="border-top:1.5px solid var(--border); padding-top:12px; margin-top:4px;">
      <div class="bar-label" style="font-weight:600;">Total</div>
      <div class="bar-track" style="visibility:hidden;"></div>
      <div class="bar-amt" style="font-weight:600;">${fmt(totalExpense)}</div>
    </div>`;
  container.innerHTML = rowsHtml + totalHtml;
}

function renderYearChart(monthly) {
  const labels = monthly.map((m) => MONTH_NAMES[m.month - 1].slice(0, 3));
  const income = monthly.map((m) => m.income || 0);
  const expense = monthly.map((m) => m.expense || 0);

  const ctx = document.getElementById('year-chart').getContext('2d');
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: income, borderColor: '#2a8a5f', backgroundColor: 'rgba(42,138,95,0.18)', fill: true, tension: 0.25 },
        { label: 'Expenses', data: expense, borderColor: '#c94235', backgroundColor: 'rgba(201,66,53,0.18)', fill: true, tension: 0.25 }
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

function renderMonthlyTable(monthly) {
  const table = document.getElementById('monthly-table');
  table.innerHTML = `
    <thead>
      <tr><th>Month</th><th style="text-align:right">Income</th><th style="text-align:right">Expenses</th><th style="text-align:right">Net</th></tr>
    </thead>
    <tbody>
      ${monthly
        .map((m) => {
          const net = (m.income || 0) - (m.expense || 0);
          return `
        <tr>
          <td>${MONTH_NAMES[m.month - 1]}</td>
          <td class="num">${fmt(m.income)}</td>
          <td class="num">${fmt(m.expense)}</td>
          <td class="num" style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(net)}</td>
        </tr>`;
        })
        .join('')}
    </tbody>`;
}

async function init() {
  await load();
}

checkSession();
