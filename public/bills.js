const fmt = (n) => (n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));

function ordinal(n) {
  n = parseInt(n, 10);
  if (isNaN(n)) return '?';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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

  const totalAnnual = withAmount.reduce((s, b) => {
    if (b.schedule_type === 'fixed_day') return s + b.amount * 12; // fixed-day bills are monthly
    return s + b.amount * (365 / (b.cycle_days || 30));
  }, 0);

  const avgMonthly = withAmount.reduce((s, b) => {
    if (b.schedule_type === 'fixed_day') return s + b.amount; // fixed-day bills are already monthly
    return s + b.amount * (30 / (b.cycle_days || 30));
  }, 0);

  document.getElementById('b-total').textContent = fmt(totalAnnual);
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
      const scheduleLabel = b.schedule_type === 'fixed_day'
        ? `due on the ${ordinal(b.fixed_day)} each month`
        : `every ~${b.cycle_days} days`;
      return `
    <div class="bill-row">
      <div class="bill-main">
        <div class="bill-name">${b.name}${b.amount ? ` — ${fmt(b.amount)}` : ''}</div>
        <div class="bill-meta">${scheduleLabel} · ${nextDateLabel}</div>
      </div>
      <div class="bill-status ${status.cls}">${status.label}</div>
      <div class="bill-actions">
        <button class="bill-btn" data-charged="${b.id}">mark charged today</button>
        <button class="bill-btn" data-edit="${b.id}" data-schedule="${b.schedule_type}" data-cycle="${b.cycle_days}" data-fixedday="${b.fixed_day || ''}" data-amount="${b.amount || ''}" data-name="${b.name}" data-last-charged="${b.last_charged_date || ''}">edit</button>
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

      const isFixed = confirm(
        'Click OK if this bill is due on a FIXED day every month (like rent on the 1st).\nClick Cancel if it cycles roughly every N days with no fixed date (like most subscriptions).'
      );

      const payload = { name: newName.trim() };
      if (newAmount !== null) payload.amount = newAmount.trim() === '' ? null : parseFloat(newAmount);

      if (isFixed) {
        const dayStr = prompt('Which day of the month is it due? (1-31)', btn.dataset.fixedday || '1');
        const day = parseInt(dayStr, 10);
        if (isNaN(day) || day < 1 || day > 31) {
          alert('Day must be a number between 1 and 31. Edit not saved — try again.');
          return;
        }
        payload.schedule_type = 'fixed_day';
        payload.fixed_day = day;
      } else {
        const newCycle = prompt('Billing cycle length in days:', btn.dataset.cycle);
        if (newCycle !== null && !isNaN(parseInt(newCycle, 10))) payload.cycle_days = parseInt(newCycle, 10);
        payload.schedule_type = 'cycle';

        const newDate = prompt('Last charged date (YYYY-MM-DD, leave blank to clear):', btn.dataset.lastCharged || '');
        if (newDate !== null) {
          const trimmed = newDate.trim();
          if (trimmed !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            alert('Date must be in YYYY-MM-DD format, e.g. 2026-08-15. Edit not saved — try again.');
            return;
          }
          payload.last_charged_date = trimmed === '' ? null : trimmed;
        }
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

  const isFixed = confirm(
    'Click OK if this bill is due on a FIXED day every month (like rent on the 1st).\nClick Cancel if it cycles roughly every N days with no fixed date (like most subscriptions).'
  );

  const payload = { name: name.trim(), amount };

  if (isFixed) {
    const dayStr = prompt('Which day of the month is it due? (1-31)', '1');
    const day = parseInt(dayStr, 10);
    if (isNaN(day) || day < 1 || day > 31) {
      alert('Day must be a number between 1 and 31. Bill not saved — try again.');
      return;
    }
    payload.schedule_type = 'fixed_day';
    payload.fixed_day = day;
  } else {
    const cycleStr = prompt('Billing cycle length in days (e.g. 30):', '30');
    payload.cycle_days = cycleStr && !isNaN(parseInt(cycleStr, 10)) ? parseInt(cycleStr, 10) : 30;
    payload.schedule_type = 'cycle';

    const dateStr = prompt('Last date it was charged (YYYY-MM-DD, leave blank if unknown):');
    if (dateStr && dateStr.trim() !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
        alert('Date must be in YYYY-MM-DD format, e.g. 2026-08-15. Bill not saved — try again.');
        return;
      }
      payload.last_charged_date = dateStr.trim();
    }
  }

  await fetch('/api/bills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  loadBills();
});

checkSession();
