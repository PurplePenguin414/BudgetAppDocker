const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  accounts: [],
  contributions: [],
  totalChart: null,
  acctChart: null
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

document.getElementById('add-acct-link').addEventListener('click', async () => {
  const name = prompt('New account name (e.g. lender or plan name):');
  if (!name || !name.trim()) return;
  const type = prompt('Account type (e.g. "traditional", "roth") — optional:') || null;
  const res = await fetch('/api/retirement/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), account_type: type })
  });
  if (res.ok) {
    refreshMonth();
    loadTrend();
  } else {
    const err = await res.json();
    alert(err.error || 'Could not add account');
  }
});

async function refreshMonth() {
  renderMonthLabel();
  const [balRes, contribRes] = await Promise.all([
    fetch(`/api/retirement/balances/${state.year}/${state.month}`),
    fetch(`/api/retirement/contributions/${state.year}/${state.month}`)
  ]);
  const balData = await balRes.json();
  const contribData = await contribRes.json();
  state.accounts = balData.accounts;
  state.contributions = contribData.entries;
  renderAccountList(balData.accounts, contribData.totalsByAccount);
  renderContribList(contribData.entries);
  populateAccountSelect(balData.accounts);
  await renderMetrics(balData.accounts, contribData.totalsByAccount);
}

function renderAccountList(accounts, totalsByAccount) {
  const container = document.getElementById('acct-list');
  if (accounts.length === 0) {
    container.innerHTML = '<div class="empty-msg">No accounts added yet.</div>';
    return;
  }
  container.innerHTML = accounts
    .map((a) => {
      const totals = totalsByAccount[a.account_id] || { contribution: 0, employer_contribution: 0 };

      let expectedLine = '';
      if (a.expected_balance !== null && a.expected_balance !== undefined) {
        expectedLine = `<div class="acct-subtitle">expected: ${fmt(a.expected_balance)} (${fmt(a.prev_balance)} last month + ${fmt(a.contributed_this_month)} contributed)</div>`;
        if (a.balance !== null && a.balance !== undefined) {
          const diff = a.balance - a.expected_balance;
          const diffColor = diff >= 0 ? 'var(--green)' : 'var(--red)';
          const diffLabel = (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff));
          expectedLine += `<div class="acct-subtitle">vs. actual: <span style="color:${diffColor}">${diffLabel}</span></div>`;
        }
      } else {
        expectedLine = `<div class="acct-subtitle">no prior balance yet to calculate an expected amount</div>`;
      }

      return `
    <div class="acct-row">
      <div class="acct-name">
        <div class="name">${a.name}</div>
        ${a.account_type ? `<div class="type">${a.account_type}</div>` : ''}
        <div class="acct-subtitle">logged this month: ${fmt(totals.contribution)} you + ${fmt(totals.employer_contribution)} employer = ${fmt((totals.contribution || 0) + (totals.employer_contribution || 0))} total</div>
        ${expectedLine}
        <div class="goal-edit-row">
          <select data-goal-account-id="${a.account_id}" data-goal-field="goal_type">
            <option value="" ${!a.goal_type ? 'selected' : ''}>No goal</option>
            <option value="dollar" ${a.goal_type === 'dollar' ? 'selected' : ''}>$ per year</option>
            <option value="percent" ${a.goal_type === 'percent' ? 'selected' : ''}>% of income</option>
          </select>
          <input type="number" step="0.01" min="0" data-goal-account-id="${a.account_id}" data-goal-field="goal_amount" value="${a.goal_amount !== null && a.goal_amount !== undefined ? a.goal_amount : ''}" placeholder="${a.goal_type === 'percent' ? 'e.g. 15' : 'e.g. 23500'}" style="display:${a.goal_type ? 'inline-block' : 'none'};" />
        </div>
      </div>
      <div class="acct-input-wrap">
        <span>balance $</span>
        <input type="number" step="0.01" min="0" data-account-id="${a.account_id}" value="${a.balance !== null ? a.balance : ''}" placeholder="balance" />
      </div>
      <span class="save-hint" id="hint-${a.account_id}">saved</span>
    </div>`;
    })
    .join('');

  container.querySelectorAll('[data-goal-field]').forEach((el) => {
    el.addEventListener('change', async () => {
      const accountId = el.dataset.goalAccountId;
      const field = el.dataset.goalField;
      const row = el.closest('.acct-name');
      const amountInput = row.querySelector('[data-goal-field="goal_amount"]');

      if (field === 'goal_type') {
        amountInput.style.display = el.value ? 'inline-block' : 'none';
        amountInput.placeholder = el.value === 'percent' ? 'e.g. 15' : 'e.g. 23500';
        await fetch(`/api/retirement/accounts/${accountId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal_type: el.value || null })
        });
        if (!el.value) refreshMonth();
      } else {
        const val = el.value.trim() === '' ? null : parseFloat(el.value);
        await fetch(`/api/retirement/accounts/${accountId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal_amount: val })
        });
      }
    });
  });

  container.querySelectorAll('input:not([data-goal-field])').forEach((input) => {
    input.addEventListener('change', async () => {
      const accountId = input.dataset.accountId;
      const balance = parseFloat(input.value);
      if (isNaN(balance) || balance < 0) return;

      await fetch('/api/retirement/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, year: state.year, month: state.month, balance })
      });

      const hint = document.getElementById(`hint-${accountId}`);
      hint.classList.add('show');
      setTimeout(() => hint.classList.remove('show'), 1500);

      await refreshMonth();
      loadTrend();
    });
  });
}

function renderContribList(entries) {
  const container = document.getElementById('contrib-list');
  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-msg">Nothing logged for this month yet.</div>';
    return;
  }
  container.innerHTML = entries
    .map(
      (e) => `
    <div class="contrib-row">
      <div>
        <span class="contrib-acct">${e.account_name}</span>
        <span class="contrib-amts">${fmt(e.contribution)} you · ${fmt(e.employer_contribution)} employer · <strong>${fmt((e.contribution || 0) + (e.employer_contribution || 0))} total</strong></span>
        ${e.note ? `<span class="contrib-note">${e.note}</span>` : ''}
      </div>
      <button class="contrib-del" data-id="${e.id}">delete</button>
    </div>`
    )
    .join('');

  container.querySelectorAll('.contrib-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/retirement/contribution/${btn.dataset.id}`, { method: 'DELETE' });
      refreshMonth();
    });
  });
}

function populateAccountSelect(accounts) {
  const sel = document.getElementById('cf-account');
  const prevValue = sel.value;
  sel.innerHTML = accounts.map((a) => `<option value="${a.account_id}">${a.name}</option>`).join('');
  if (accounts.some((a) => String(a.account_id) === prevValue)) sel.value = prevValue;
}

document.getElementById('cf-submit').addEventListener('click', async () => {
  const accountId = document.getElementById('cf-account').value;
  if (!accountId) {
    alert('Add an account first.');
    return;
  }
  const youRaw = document.getElementById('cf-you').value;
  const employerRaw = document.getElementById('cf-employer').value;
  const contribution = youRaw.trim() !== '' ? parseFloat(youRaw) : null;
  const employer_contribution = employerRaw.trim() !== '' ? parseFloat(employerRaw) : null;
  if (contribution === null && employer_contribution === null) {
    alert('Enter an amount for you, your employer, or both.');
    return;
  }
  const note = document.getElementById('cf-note').value.trim() || null;

  await fetch('/api/retirement/contribution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, year: state.year, month: state.month, contribution, employer_contribution, note })
  });

  document.getElementById('cf-you').value = '';
  document.getElementById('cf-employer').value = '';
  document.getElementById('cf-note').value = '';
  refreshMonth();
});

async function renderMetrics(accounts, totalsByAccount) {
  const logged = accounts.filter((a) => a.balance !== null && a.balance !== undefined);
  const total = logged.reduce((s, a) => s + a.balance, 0);

  document.getElementById('r-total').textContent = fmt(total);
  document.getElementById('r-count').textContent = `${logged.length} / ${accounts.length}`;

  if (!totalsByAccount) {
    const contribRes = await fetch(`/api/retirement/contributions/${state.year}/${state.month}`);
    const contribData = await contribRes.json();
    totalsByAccount = contribData.totalsByAccount;
  }
  const yourContrib = Object.values(totalsByAccount).reduce((s, t) => s + (t.contribution || 0), 0);
  const employerContrib = Object.values(totalsByAccount).reduce((s, t) => s + (t.employer_contribution || 0), 0);
  document.getElementById('r-contrib').textContent = `${fmt(yourContrib)} + ${fmt(employerContrib)} = ${fmt(yourContrib + employerContrib)}`;

  const trendRes = await fetch('/api/retirement/trend');
  const trend = await trendRes.json();
  const curKey = `${state.year}-${String(state.month).padStart(2, '0')}`;
  const priorMonths = trend.months.filter((m) => m.key < curKey);
  const changeEl = document.getElementById('r-change');

  if (priorMonths.length === 0 || logged.length === 0) {
    changeEl.textContent = '—';
    changeEl.className = 'metric-value';
  } else {
    const prevTotal = priorMonths[priorMonths.length - 1].total;
    const change = total - prevTotal;
    changeEl.textContent = (change >= 0 ? '+' : '−') + fmt(Math.abs(change));
    changeEl.className = 'metric-value ' + (change >= 0 ? 'v-green' : 'v-red');
  }
}

async function loadTrend() {
  const res = await fetch('/api/retirement/trend');
  const data = await res.json();
  renderTotalChart(data.months);
  renderAccountSelect(data.byAccount);
}

function renderTotalChart(months) {
  const labels = months.map((m) => {
    const [y, mo] = m.key.split('-');
    return `${MONTH_NAMES[parseInt(mo, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
  });
  const totals = months.map((m) => m.total);

  const ctx = document.getElementById('total-retirement-chart').getContext('2d');
  if (state.totalChart) state.totalChart.destroy();
  state.totalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total retirement',
        data: totals,
        borderColor: '#2a8a5f',
        backgroundColor: 'rgba(42,138,95,0.15)',
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

function renderAccountSelect(byAccount) {
  const sel = document.getElementById('acct-trend-select');
  const names = Object.keys(byAccount);
  const prev = sel.value;
  sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join('');
  if (names.length === 0) {
    document.getElementById('acct-trend-chart').style.display = 'none';
    return;
  }
  document.getElementById('acct-trend-chart').style.display = 'block';
  sel.value = names.includes(prev) ? prev : names[0];
  renderAccountChart(byAccount, sel.value);
  sel.onchange = () => renderAccountChart(byAccount, sel.value);
}

function renderAccountChart(byAccount, name) {
  const monthMap = byAccount[name] || {};
  const keys = Object.keys(monthMap).sort();
  const labels = keys.map((k) => {
    const [y, m] = k.split('-');
    return `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
  });
  const values = keys.map((k) => monthMap[k]);

  const ctx = document.getElementById('acct-trend-chart').getContext('2d');
  if (state.acctChart) state.acctChart.destroy();
  state.acctChart = new Chart(ctx, {
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
