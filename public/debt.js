const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  debts: [],
  totalChart: null,
  debtChart: null,
  dedicatedChart: null
};

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

document.getElementById('prev-month').addEventListener('click', () => {
  state.month--;
  if (state.month < 1) { state.month = 12; state.year--; }
  refreshMonth();
  refreshDedicated();
});
document.getElementById('next-month').addEventListener('click', () => {
  state.month++;
  if (state.month > 12) { state.month = 1; state.year++; }
  refreshMonth();
  refreshDedicated();
});

function renderMonthLabel() {
  document.getElementById('month-label').textContent = `${MONTH_NAMES[state.month - 1]} ${state.year}`;
}

document.getElementById('add-debt-link').addEventListener('click', async () => {
  const name = prompt('New debt name (e.g. lender or account name):');
  if (!name || !name.trim()) return;
  const res = await fetch('/api/debts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  });
  if (res.ok) {
    refreshMonth();
    loadTrend();
  } else {
    const err = await res.json();
    alert(err.error || 'Could not add debt');
  }
});

async function refreshMonth() {
  renderMonthLabel();
  const res = await fetch(`/api/debts/balances/${state.year}/${state.month}`);
  const data = await res.json();
  state.debts = data.debts;
  renderDebtList(data.debts);
  await renderMetrics(data.debts);
}

function renderDebtList(debts) {
  const container = document.getElementById('debt-list');
  if (debts.length === 0) {
    container.innerHTML = '<div class="empty-msg">No debts added yet.</div>';
    return;
  }
  container.innerHTML = debts
    .map(
      (d) => `
    <div class="debt-row-wrap">
      <div class="debt-row">
        <div class="debt-name">${d.name}</div>
        <div class="debt-input-wrap">
          <span>$</span>
          <input type="number" step="0.01" min="0" data-debt-id="${d.debt_id}" value="${d.balance !== null ? d.balance : ''}" placeholder="balance" />
          <span class="save-hint" id="hint-${d.debt_id}">saved</span>
        </div>
      </div>
      <div class="debt-goal-row">
        <span>debt-free by:</span>
        <input type="date" data-goal-debt-id="${d.debt_id}" value="${d.target_payoff_date || ''}" />
      </div>
    </div>`
    )
    .join('');

  container.querySelectorAll('[data-goal-debt-id]').forEach((input) => {
    input.addEventListener('change', async () => {
      await fetch(`/api/debts/${input.dataset.goalDebtId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_payoff_date: input.value || null })
      });
    });
  });

  container.querySelectorAll('.debt-input-wrap input').forEach((input) => {
    input.addEventListener('change', async () => {
      const balance = parseFloat(input.value);
      if (isNaN(balance) || balance < 0) return;
      await fetch('/api/debts/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debt_id: input.dataset.debtId, year: state.year, month: state.month, balance })
      });
      const hint = document.getElementById(`hint-${input.dataset.debtId}`);
      hint.classList.add('show');
      setTimeout(() => hint.classList.remove('show'), 1500);
      state.debts = state.debts.map((d) =>
        d.debt_id == input.dataset.debtId ? { ...d, balance } : d
      );
      await renderMetrics(state.debts);
      loadTrend();
    });
  });
}

async function renderMetrics(debts) {
  const logged = debts.filter((d) => d.balance !== null && d.balance !== undefined);
  const total = logged.reduce((s, d) => s + d.balance, 0);

  document.getElementById('d-total').textContent = fmt(total);
  document.getElementById('d-count').textContent = `${logged.length} / ${debts.length}`;

  // Find previous logged month's total from trend data
  const trendRes = await fetch('/api/debts/trend');
  const trend = await trendRes.json();
  const curKey = `${state.year}-${String(state.month).padStart(2, '0')}`;
  const priorMonths = trend.months.filter((m) => m.key < curKey);
  const changeEl = document.getElementById('d-change');

  if (priorMonths.length === 0 || logged.length === 0) {
    changeEl.textContent = '—';
    changeEl.className = 'metric-value';
  } else {
    const prevTotal = priorMonths[priorMonths.length - 1].total;
    const change = total - prevTotal;
    changeEl.textContent = (change <= 0 ? '−' : '+') + fmt(Math.abs(change));
    changeEl.className = 'metric-value ' + (change <= 0 ? 'v-green' : 'v-red');
  }
}

async function loadTrend() {
  const res = await fetch('/api/debts/trend');
  const data = await res.json();
  renderTotalChart(data.months);
  renderDebtSelect(data.byDebt);
}

function renderTotalChart(months) {
  const labels = months.map((m) => {
    const [y, mo] = m.key.split('-');
    return `${MONTH_NAMES[parseInt(mo, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
  });
  const totals = months.map((m) => m.total);

  const ctx = document.getElementById('total-debt-chart').getContext('2d');
  if (state.totalChart) state.totalChart.destroy();
  state.totalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total debt',
        data: totals,
        borderColor: '#c94235',
        backgroundColor: 'rgba(201,66,53,0.15)',
        fill: true,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: (v) => '$' + v } },
        x: { ticks: { font: { family: 'DM Mono', size: 10 } } }
      }
    }
  });
}

function renderDebtSelect(byDebt) {
  const sel = document.getElementById('debt-trend-select');
  const names = Object.keys(byDebt);
  const prev = sel.value;
  sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join('');
  if (names.length === 0) {
    document.getElementById('debt-trend-chart').style.display = 'none';
    return;
  }
  document.getElementById('debt-trend-chart').style.display = 'block';
  sel.value = names.includes(prev) ? prev : names[0];
  renderDebtChart(byDebt, sel.value);
  sel.onchange = () => renderDebtChart(byDebt, sel.value);
}

function renderDebtChart(byDebt, name) {
  const monthMap = byDebt[name] || {};
  const keys = Object.keys(monthMap).sort();
  const labels = keys.map((k) => {
    const [y, m] = k.split('-');
    return `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
  });
  const values = keys.map((k) => monthMap[k]);

  const ctx = document.getElementById('debt-trend-chart').getContext('2d');
  if (state.debtChart) state.debtChart.destroy();
  state.debtChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: name,
        data: values,
        borderColor: '#2761a0',
        backgroundColor: 'rgba(39,97,160,0.15)',
        fill: true,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v) => '$' + v } } }
    }
  });
}

// ---------- Dedicated account ----------
document.getElementById('ded-actual-input').addEventListener('change', saveDedicatedActual);

async function saveDedicatedActual() {
  const actualRaw = document.getElementById('ded-actual-input').value;
  const actual = actualRaw === '' ? null : parseFloat(actualRaw);

  await fetch('/api/dedicated/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: state.year, month: state.month, actual })
  });

  const hint = document.getElementById('ded-hint');
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 1500);

  refreshDedicated();
}

function updateDedicatedMetrics(expected, actual) {
  document.getElementById('ded-expected').textContent = fmt(expected);
  document.getElementById('ded-actual').textContent = fmt(actual);
  const varEl = document.getElementById('ded-variance');
  if (expected === null || actual === null || actual === undefined) {
    varEl.textContent = '—';
    varEl.className = 'metric-value';
  } else {
    const diff = actual - expected;
    varEl.textContent = (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff));
    varEl.className = 'metric-value ' + (diff >= 0 ? 'v-green' : 'v-red');
  }
}

document.getElementById('add-deposit-link').addEventListener('click', async () => {
  const amountStr = prompt('Deposit amount ($):');
  if (!amountStr) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return;
  const note = prompt('Note (optional, e.g. "Monthly settlement account draft"):') || '';
  await fetch('/api/dedicated/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: state.year, month: state.month, amount, note })
  });
  refreshDedicated();
});

document.getElementById('add-withdrawal-link').addEventListener('click', async () => {
  const amountStr = prompt('Withdrawal amount ($):');
  if (!amountStr) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return;
  const note = prompt('What was it for? (e.g. "PNC settlement fee")') || '';
  await fetch('/api/dedicated/withdrawal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: state.year, month: state.month, amount, note })
  });
  refreshDedicated();
});

function renderDedList(containerId, items, onDelete) {
  const list = document.getElementById(containerId);
  if (items.length === 0) {
    list.innerHTML = '<div class="empty-msg">Nothing logged for this month.</div>';
    return;
  }
  list.innerHTML = items
    .map(
      (w) => `
    <div class="wd-row">
      <div>
        <span class="wd-amt">${fmt(w.amount)}</span>
        ${w.note ? `<span class="wd-note">${w.note}</span>` : ''}
      </div>
      <button class="wd-del" data-id="${w.id}">delete</button>
    </div>`
    )
    .join('');
  list.querySelectorAll('.wd-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await onDelete(btn.dataset.id);
      refreshDedicated();
    });
  });
}

async function refreshDedicated() {
  const res = await fetch(`/api/dedicated/${state.year}/${state.month}`);
  const data = await res.json();

  document.getElementById('ded-actual-input').value = data.actual !== null ? data.actual : '';
  updateDedicatedMetrics(data.expectedCumulative, data.actual);

  renderDedList('ded-deposits', data.deposits, async (id) => {
    await fetch(`/api/dedicated/deposit/${id}`, { method: 'DELETE' });
  });
  renderDedList('ded-withdrawals', data.withdrawals, async (id) => {
    await fetch(`/api/dedicated/withdrawal/${id}`, { method: 'DELETE' });
  });

  loadDedicatedTrend();
}

async function loadDedicatedTrend() {
  const res = await fetch('/api/dedicated/trend');
  const data = await res.json();

  const labels = data.months.map((m) => {
    const [y, mo] = m.key.split('-');
    return `${MONTH_NAMES[parseInt(mo, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
  });
  const expected = data.months.map((m) => m.expected);
  const actual = data.months.map((m) => m.actual);

  const ctx = document.getElementById('ded-trend-chart').getContext('2d');
  if (state.dedicatedChart) state.dedicatedChart.destroy();
  state.dedicatedChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Expected', data: expected, borderColor: '#7a7870', backgroundColor: 'transparent', borderDash: [4, 3], tension: 0.25 },
        { label: 'Actual', data: actual, borderColor: '#2761a0', backgroundColor: 'rgba(39,97,160,0.15)', fill: true, tension: 0.25 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { font: { family: 'DM Sans', size: 11 } } } },
      scales: { y: { ticks: { callback: (v) => '$' + v } } }
    }
  });
}

async function init() {
  await refreshMonth();
  await loadTrend();
  await refreshDedicated();
}

checkSession();
