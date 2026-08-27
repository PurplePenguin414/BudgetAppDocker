const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.loggedIn) {
    window.location.href = 'index.html';
    return;
  }
  init();
}

async function loadNetWorth() {
  const res = await fetch('/api/networth');
  const data = await res.json();

  document.getElementById('nw-saved').textContent = fmt(data.totalSaved);
  document.getElementById('nw-dedicated').textContent = fmt(data.dedicatedActual);
  document.getElementById('nw-debt').textContent = fmt(data.totalDebt);

  const nwEl = document.getElementById('nw-networth');
  nwEl.textContent = fmt(data.netWorth);
  nwEl.className = 'metric-value ' + (data.netWorth >= 0 ? 'v-green' : 'v-red');
}

async function loadSavings() {
  const res = await fetch('/api/savings/summary');
  const data = await res.json();

  document.getElementById('s-total').textContent = fmt(data.totalSaved);
  document.getElementById('s-allocated').textContent = fmt(data.allocated);

  const unallocEl = document.getElementById('s-unallocated');
  unallocEl.textContent = fmt(data.unallocated);
  unallocEl.className = 'metric-value ' + (data.unallocated < 0 ? 'v-red' : '');

  renderAllocations(data.allocations, data.unallocated);
  renderWithdrawals(data.withdrawals);
}

function renderWithdrawals(withdrawals) {
  const container = document.getElementById('withdrawal-list');
  if (withdrawals.length === 0) {
    container.innerHTML = '<div class="empty-msg">No withdrawals logged.</div>';
    return;
  }
  container.innerHTML = withdrawals
    .map(
      (w) => `
    <div class="wd-row">
      <div>
        <span class="wd-date">${MONTH_NAMES[w.month - 1].slice(0, 3)} ${w.year}</span>
        <span class="wd-amt">${fmt(w.amount)}</span>
        ${w.note ? `<span class="wd-note">${w.note}</span>` : ''}
      </div>
      <button class="wd-del" data-id="${w.id}">delete</button>
    </div>`
    )
    .join('');

  container.querySelectorAll('.wd-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/savings/withdrawal/${btn.dataset.id}`, { method: 'DELETE' });
      loadSavings();
      loadNetWorth();
    });
  });
}

function initWithdrawalForm() {
  const monthSel = document.getElementById('wf-month');
  monthSel.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const now = new Date();
  monthSel.value = now.getMonth() + 1;
  document.getElementById('wf-year').value = now.getFullYear();
}

document.getElementById('wf-submit').addEventListener('click', async () => {
  const month = parseInt(document.getElementById('wf-month').value, 10);
  const year = parseInt(document.getElementById('wf-year').value, 10);
  const amount = parseFloat(document.getElementById('wf-amount').value);
  if (isNaN(amount) || amount <= 0) {
    alert('Enter an amount greater than 0.');
    return;
  }
  const note = document.getElementById('wf-note').value.trim() || null;

  await fetch('/api/savings/withdrawal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, month, amount, note })
  });

  document.getElementById('wf-amount').value = '';
  document.getElementById('wf-note').value = '';
  loadSavings();
  loadNetWorth();
});

function renderAllocations(allocations, unallocated) {
  const container = document.getElementById('alloc-card');
  if (allocations.length === 0) {
    container.innerHTML = '<div class="empty-msg">Nothing dedicated yet. Use the link below to earmark part of your savings.</div>';
    return;
  }

  const rowsHtml = allocations
    .map((a) => {
      let progressHtml = '';
      if (a.target_amount) {
        const pct = Math.min((a.amount / a.target_amount) * 100, 100);
        progressHtml = `
      <div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:${a.amount >= a.target_amount ? 'var(--green)' : 'var(--blue)'}"></div></div>
      <div class="goal-progress-label">${fmt(a.amount)} of ${fmt(a.target_amount)} (${pct.toFixed(0)}%)</div>`;
      }
      return `
    <div class="alloc-row-wrap">
      <div class="alloc-row">
        <div class="alloc-name">${a.name}</div>
        <div class="alloc-input-wrap">
          <span>$</span>
          <input type="number" step="0.01" min="0" data-field="amount" data-id="${a.id}" value="${a.amount}" />
        </div>
        <div class="alloc-input-wrap">
          <span>goal $</span>
          <input type="number" step="0.01" min="0" data-field="target_amount" data-id="${a.id}" value="${a.target_amount !== null ? a.target_amount : ''}" placeholder="optional" />
        </div>
        <span class="save-hint" id="hint-${a.id}">saved</span>
        <button class="alloc-del" data-id="${a.id}">delete</button>
      </div>
      ${progressHtml}
    </div>`;
    })
    .join('');

  const unallocHtml = `
    <div class="unalloc-row">
      <span>Unallocated</span>
      <span style="color:${unallocated < 0 ? 'var(--red)' : 'var(--text)'}">${fmt(unallocated)}</span>
    </div>`;

  container.innerHTML = rowsHtml + unallocHtml;

  container.querySelectorAll('.alloc-input-wrap input').forEach((input) => {
    input.addEventListener('change', async () => {
      const field = input.dataset.field;
      const raw = input.value;
      let value;
      if (field === 'target_amount') {
        value = raw.trim() === '' ? null : parseFloat(raw);
      } else {
        value = parseFloat(raw);
        if (isNaN(value) || value < 0) return;
      }
      await fetch(`/api/savings/allocations/${input.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
      const hint = document.getElementById(`hint-${input.dataset.id}`);
      hint.classList.add('show');
      setTimeout(() => hint.classList.remove('show'), 1500);
      loadSavings();
    });
  });

  container.querySelectorAll('.alloc-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/savings/allocations/${btn.dataset.id}`, { method: 'DELETE' });
      loadSavings();
    });
  });
}

document.getElementById('add-alloc-link').addEventListener('click', async () => {
  const name = prompt('What is this money for? (e.g. "Emergency fund", "Car repair fund")');
  if (!name || !name.trim()) return;
  const amountStr = prompt('How much of your saved money to dedicate to this ($)?');
  if (!amountStr) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < 0) return;
  await fetch('/api/savings/allocations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), amount })
  });
  loadSavings();
});

async function init() {
  initWithdrawalForm();
  await loadNetWorth();
  await loadSavings();
}

checkSession();
