const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const PIE_COLORS = ['#2761a0','#c94235','#2a8a5f','#b87318','#7a5ea8','#c9598a','#4a9d9c','#9a8a3a','#a05e27','#6a7a3a','#8a6a8a','#3a6a8a','#a03a3a','#6a8a5a'];

async function checkSessionAndLoad() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.loggedIn) {
    window.location.href = 'index.html';
    return;
  }
  await load();
}

async function load() {
  const res = await fetch('/api/averages');
  const data = await res.json();

  if (data.monthCount === 0) {
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('content').style.display = 'none';
    return;
  }

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('content').style.display = 'block';
  document.getElementById('month-count-label').textContent =
    `Averaged across ${data.monthCount} month${data.monthCount === 1 ? '' : 's'} of data`;

  document.getElementById('a-income').textContent = fmt(data.totals.avgIncome);
  document.getElementById('a-expense').textContent = fmt(data.totals.avgExpense);

  const netEl = document.getElementById('a-net');
  netEl.textContent = fmt(data.totals.avgNet);
  netEl.className = 'metric-value ' + (data.totals.avgNet >= 0 ? 'v-green' : 'v-red');

  const rate = data.totals.avgIncome > 0 ? Math.round((data.totals.avgNet / data.totals.avgIncome) * 100) : 0;
  const rateEl = document.getElementById('a-rate');
  rateEl.textContent = rate + '%';
  rateEl.className = 'metric-value ' + (rate >= 10 ? 'v-green' : rate >= 0 ? 'v-amber' : 'v-red');

  renderRuleCard(data.bucketAverages, data.totals.avgIncome);
  renderExpenseBars(data.expense);
  renderExpensePie(data.expense);
  renderIncomeBars(data.income);
}

function renderRuleCard(bucketAverages, avgIncome) {
  const container = document.getElementById('rule-card');
  if (avgIncome <= 0) {
    container.innerHTML = '<div class="empty-msg">No income logged yet.</div>';
    return;
  }
  const buckets = [
    { key: 'needs', label: 'Needs', target: 50, color: '#2761a0' },
    { key: 'wants', label: 'Wants', target: 30, color: '#b87318' },
    { key: 'savings', label: 'Savings / investing', target: 20, color: '#2a8a5f' }
  ];
  container.innerHTML = buckets
    .map((b) => {
      const amt = bucketAverages[b.key] || 0;
      const pct = (amt / avgIncome) * 100;
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

function renderExpenseBars(expense) {
  const container = document.getElementById('expense-bars');
  const sorted = [...expense].sort((a, b) => b.avg - a.avg).filter((e) => e.avg > 0);
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-msg">No expenses logged yet.</div>';
    return;
  }
  const max = sorted[0].avg;
  container.innerHTML = sorted
    .map(
      (e) => `
    <div class="bar-row">
      <div class="bar-label">${e.category}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(e.avg / max) * 100}%;background:var(--blue)"></div></div>
      <div class="bar-amt">${fmt(e.avg)}</div>
    </div>`
    )
    .join('');
}

function renderIncomeBars(income) {
  const container = document.getElementById('income-bars');
  const sorted = [...income].sort((a, b) => b.avg - a.avg).filter((e) => e.avg > 0);
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-msg">No income logged yet.</div>';
    return;
  }
  const max = sorted[0].avg;
  container.innerHTML = sorted
    .map(
      (e) => `
    <div class="bar-row">
      <div class="bar-label">${e.category}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(e.avg / max) * 100}%;background:var(--green)"></div></div>
      <div class="bar-amt">${fmt(e.avg)}</div>
    </div>`
    )
    .join('');
}

let pieChart = null;
function renderExpensePie(expense) {
  const sorted = [...expense].sort((a, b) => b.avg - a.avg).filter((e) => e.avg > 0);
  const canvas = document.getElementById('expense-pie');
  if (sorted.length === 0) {
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    return;
  }
  const ctx = canvas.getContext('2d');
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: sorted.map((e) => e.category),
      datasets: [{
        data: sorted.map((e) => e.avg),
        backgroundColor: sorted.map((_, i) => PIE_COLORS[i % PIE_COLORS.length])
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'DM Sans', size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}` } }
      }
    }
  });
}

checkSessionAndLoad();
