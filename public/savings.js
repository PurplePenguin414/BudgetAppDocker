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
}

function renderAllocations(allocations, unallocated) {
  const container = document.getElementById('alloc-card');
  if (allocations.length === 0) {
    container.innerHTML = '<div class="empty-msg">Nothing dedicated yet. Use the link below to earmark part of your savings.</div>';
    return;
  }

  const rowsHtml = allocations
    .map(
      (a) => `
    <div class="alloc-row">
      <div class="alloc-name">${a.name}</div>
      <div class="alloc-input-wrap">
        <span>$</span>
        <input type="number" step="0.01" min="0" data-id="${a.id}" value="${a.amount}" />
        <span class="save-hint" id="hint-${a.id}">saved</span>
        <button class="alloc-del" data-id="${a.id}">delete</button>
      </div>
    </div>`
    )
    .join('');

  const unallocHtml = `
    <div class="unalloc-row">
      <span>Unallocated</span>
      <span style="color:${unallocated < 0 ? 'var(--red)' : 'var(--text)'}">${fmt(unallocated)}</span>
    </div>`;

  container.innerHTML = rowsHtml + unallocHtml;

  container.querySelectorAll('.alloc-input-wrap input').forEach((input) => {
    input.addEventListener('change', async () => {
      const amount = parseFloat(input.value);
      if (isNaN(amount) || amount < 0) return;
      await fetch(`/api/savings/allocations/${input.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
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
  const name = prompt('What is this money for? (e.g. "Murphy\'s surgery fund")');
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
  await loadNetWorth();
  await loadSavings();
}

checkSession();
