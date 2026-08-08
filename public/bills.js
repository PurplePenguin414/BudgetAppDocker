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

  renderCategoryBreakdown(withAmount, totalAnnual);
}

function annualizedAmount(b) {
  if (b.schedule_type === 'fixed_day') return b.amount * 12;
  return b.amount * (365 / (b.cycle_days || 30));
}

function renderCategoryBreakdown(bills, totalAnnual) {
  const container = document.getElementById('category-breakdown');
  if (bills.length === 0 || totalAnnual <= 0) {
    container.innerHTML = '<div class="empty-msg">No bills with an amount logged yet.</div>';
    return;
  }

  const byCategory = {};
  bills.forEach((b) => {
    const key = b.category && b.category.trim() ? b.category.trim() : 'Uncategorized';
    byCategory[key] = (byCategory[key] || 0) + annualizedAmount(b);
  });

  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];

  const rowsHtml = sorted
    .map(
      ([name, amt]) => `
    <div class="bar-row">
      <div class="bar-label">${name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(amt / max) * 100}%;background:var(--blue)"></div></div>
      <div class="bar-amt">${fmt(amt)}/yr <span style="color:var(--muted)">(${((amt / totalAnnual) * 100).toFixed(0)}%)</span></div>
    </div>`
    )
    .join('');

  const totalHtml = `
    <div class="bar-row" style="border-top:1.5px solid var(--border); padding-top:12px; margin-top:4px;">
      <div class="bar-label" style="font-weight:600;">Total</div>
      <div class="bar-track" style="visibility:hidden;"></div>
      <div class="bar-amt" style="font-weight:600;">${fmt(totalAnnual)}/yr</div>
    </div>`;

  container.innerHTML = rowsHtml + totalHtml;
}

function renderBills(bills) {
  const container = document.getElementById('bills-list');
  if (bills.length === 0) {
    container.innerHTML = '<div class="empty-msg">No bills added yet.</div>';
    return;
  }

  // Group by category, preserving the incoming soonest-due-first order within each group.
  const groups = new Map();
  bills.forEach((b) => {
    const key = b.category && b.category.trim() ? b.category.trim() : 'Uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });

  // Order groups by their soonest bill's days_until (nulls last).
  const groupKeys = Array.from(groups.keys()).sort((a, b) => {
    const da = groups.get(a)[0].days_until;
    const db_ = groups.get(b)[0].days_until;
    if (da === null) return 1;
    if (db_ === null) return -1;
    return da - db_;
  });

  container.innerHTML = groupKeys
    .map((key) => {
      const groupBills = groups.get(key);
      const subtotal = groupBills.reduce((s, b) => s + (b.amount ? annualizedAmount(b) : 0), 0);
      const rowsHtml = groupBills
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
            <button class="bill-btn" data-edit="${b.id}" data-schedule="${b.schedule_type}" data-cycle="${b.cycle_days}" data-fixedday="${b.fixed_day || ''}" data-amount="${b.amount || ''}" data-name="${b.name}" data-last-charged="${b.last_charged_date || ''}" data-category="${b.category || ''}">edit</button>
            <button class="bill-del" data-del="${b.id}">delete</button>
          </div>
        </div>`;
        })
        .join('');

      return `
    <div class="bill-group">
      <div class="bill-group-header">
        <span>${key}</span>
        <span class="bill-group-subtotal">${fmt(subtotal)}/yr</span>
      </div>
      ${rowsHtml}
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
      const newCategory = prompt('Category (e.g. Home, Subscriptions, Business — leave blank for none):', btn.dataset.category || '');

      const isFixed = confirm(
        'Click OK if this bill is due on a FIXED day every month (like rent on the 1st).\nClick Cancel if it cycles roughly every N days with no fixed date (like most subscriptions).'
      );

      const payload = { name: newName.trim() };
      if (newAmount !== null) payload.amount = newAmount.trim() === '' ? null : parseFloat(newAmount);
      if (newCategory !== null) payload.category = newCategory.trim() === '' ? null : newCategory.trim();

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
  const categoryStr = prompt('Category (e.g. Home, Subscriptions, Business — leave blank for none):');
  const category = categoryStr && categoryStr.trim() !== '' ? categoryStr.trim() : null;

  const isFixed = confirm(
    'Click OK if this bill is due on a FIXED day every month (like rent on the 1st).\nClick Cancel if it cycles roughly every N days with no fixed date (like most subscriptions).'
  );

  const payload = { name: name.trim(), amount, category };

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
