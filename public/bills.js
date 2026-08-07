const fmt = (n) => (n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.loggedIn) {
    window.location.href = 'index.html';
    return;
  }
  loadBills();
}

function statusInfo(daysUntil) {
  if (daysUntil === null) return { label: 'no date set', cls: 'status-unset' };
  if (daysUntil < 0) return { label: `overdue ${Math.abs(daysUntil)}d`, cls: 'status-overdue' };
  if (daysUntil === 0) return { label: 'due today', cls: 'status-soon' };
  if (daysUntil <= 5) return { label: `due in ${daysUntil}d`, cls: 'status-soon' };
  return { label: `due in ${daysUntil}d`, cls: 'status-ok' };
}

async function loadBills() {
  const res = await fetch('/api/bills');
  const data = await res.json();
  renderBills(data.bills);
  renderSummary(data.bills);
}

function renderSummary(bills) {
  const withAmount = bills.filter((b) => b.amount !== null && b.amount !== undefined);
  const total = withAmount.reduce((s, b) => s + b.amount, 0);
  const avgMonthly = withAmount.reduce((s, b) => s + b.amount * (30 / (b.cycle_days || 30)), 0);

  document.getElementById('b-total').textContent = fmt(total);
  document.getElementById('b-avg-monthly').textContent = fmt(avgMonthly);
}

function renderBills(bills) {
  const container = document.getElementById('bills-list');
  if (bills.length === 0) {
    container.innerHTML = '<div class="empty-msg">No bills added yet.</div>';
    return;
  }

  container.innerHTML = bills
    .map((b) => {
      const status = statusInfo(b.days_until);
      const nextDateLabel = b.next_due_date ? `next: ${b.next_due_date}` : 'no charge date logged yet';
      return `
    <div class="bill-row">
      <div class="bill-main">
        <div class="bill-name">${b.name}${b.amount ? ` — ${fmt(b.amount)}` : ''}</div>
        <div class="bill-meta">every ~${b.cycle_days} days · ${nextDateLabel}</div>
      </div>
      <div class="bill-status ${status.cls}">${status.label}</div>
      <div class="bill-actions">
        <button class="bill-btn" data-charged="${b.id}">mark charged today</button>
        <button class="bill-btn" data-edit="${b.id}" data-cycle="${b.cycle_days}" data-amount="${b.amount || ''}" data-name="${b.name}" data-last-charged="${b.last_charged_date || ''}">edit</button>
        <button class="bill-del" data-del="${b.id}">delete</button>
      </div>
    </div>`;
    })
    .join('');

  container.querySelectorAll('[data-charged]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/bills/${btn.dataset.charged}/charged`, { method: 'PATCH' });
      loadBills();
    });
  });

  container.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.edit;
      const newName = prompt('Bill name:', btn.dataset.name);
      if (newName === null) return;
      const newAmount = prompt('Amount ($, leave blank if unknown):', btn.dataset.amount);
      const newCycle = prompt('Billing cycle length in days:', btn.dataset.cycle);
      const newDate = prompt('Last charged date (YYYY-MM-DD, leave blank to clear):', btn.dataset.lastCharged || '');
      const payload = { name: newName.trim() };
      if (newAmount !== null) payload.amount = newAmount.trim() === '' ? null : parseFloat(newAmount);
      if (newCycle !== null && !isNaN(parseInt(newCycle, 10))) payload.cycle_days = parseInt(newCycle, 10);
      if (newDate !== null) {
        const trimmed = newDate.trim();
        if (trimmed !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          alert('Date must be in YYYY-MM-DD format, e.g. 2026-08-15. Edit not saved — try again.');
          return;
        }
        payload.last_charged_date = trimmed === '' ? null : trimmed;
      }
      await fetch(`/api/bills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      loadBills();
    });
  });

  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/bills/${btn.dataset.del}`, { method: 'DELETE' });
      loadBills();
    });
  });
}

document.getElementById('add-bill-link').addEventListener('click', async () => {
  const name = prompt('Bill or subscription name:');
  if (!name || !name.trim()) return;
  const amountStr = prompt('Amount ($, leave blank if unknown):');
  const amount = amountStr && amountStr.trim() !== '' ? parseFloat(amountStr) : null;
  const cycleStr = prompt('Billing cycle length in days (e.g. 30):', '30');
  const cycle_days = cycleStr && !isNaN(parseInt(cycleStr, 10)) ? parseInt(cycleStr, 10) : 30;
  const dateStr = prompt('Last date it was charged (YYYY-MM-DD, leave blank if unknown):');
  let last_charged_date = null;
  if (dateStr && dateStr.trim() !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
      alert('Date must be in YYYY-MM-DD format, e.g. 2026-08-15. Bill not saved — try again.');
      return;
    }
    last_charged_date = dateStr.trim();
  }

  await fetch('/api/bills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), amount, cycle_days, last_charged_date })
  });
  loadBills();
});

checkSession();
