const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  debts: [],
  totalChart: null,
  debtChart: null
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
});
document.getElementById('next-month').addEventListener('click', () => {
  state.month++;
  if (state.month > 12) { state.month = 1; state.year++; }
  refreshMonth();
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
    <div class="debt-row">
      <div class="debt-name">${d.name}</div>
      <div class="debt-input-wrap">
        <span>$</span>
        <input type="number" step="0.01" min="0" data-debt-id="${d.debt_id}" value="${d.balance !== null ? d.balance : ''}" placeholder="balance" />
        <span class="save-hint" id="hint-${d.debt_id}">saved</span>
      </div>
    </div>`
    )
    .join('');

  container.querySelectorAll('input').forEach((input) => {
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
      await renderMetrics(state.debts.map((d) =>
        d.debt_id == input.dataset.debtId ? { ...d, balance } : d
      ));
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

async function init() {
  await refreshMonth();
  await loadTrend();
}

checkSession();
