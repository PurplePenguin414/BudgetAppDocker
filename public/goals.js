const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.loggedIn) {
    window.location.href = 'index.html';
    return;
  }
  load();
}

async function load() {
  const res = await fetch('/api/goals-overview');
  const data = await res.json();

  renderNetWorth(data.netWorth);
  renderSavingsGoals(data.savingsGoals);
  renderRetirementGoals(data.retirementGoals);
  renderDebtGoals(data.debtGoals);
}

function renderNetWorth(nw) {
  document.getElementById('g-saved').textContent = fmt(nw.totalSaved);
  document.getElementById('g-dedicated').textContent = fmt(nw.dedicatedActual);
  document.getElementById('g-debt').textContent = fmt(nw.totalDebt);

  const nwEl = document.getElementById('g-networth');
  nwEl.textContent = fmt(nw.netWorth);
  nwEl.className = 'metric-value ' + (nw.netWorth >= 0 ? 'v-green' : 'v-red');
}

function renderSavingsGoals(goals) {
  const container = document.getElementById('savings-goals-card');
  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-msg">No savings goals set yet. Add a target amount to any dedicated pot on the <a href="savings.html">Savings page</a>.</div>';
    return;
  }
  container.innerHTML = goals
    .map((g) => {
      const pct = Math.min(g.pct, 100);
      const over = g.amount >= g.target_amount;
      return `
    <div class="goal-row">
      <div class="goal-top">
        <span class="goal-name">${g.name}</span>
        <span class="goal-target">${g.pct.toFixed(0)}%</span>
      </div>
      <div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:${over ? 'var(--green)' : 'var(--blue)'}"></div></div>
      <div class="goal-meta">
        <span>${fmt(g.amount)} saved</span>
        <span>of ${fmt(g.target_amount)} goal</span>
      </div>
    </div>`;
    })
    .join('');
}

function renderRetirementGoals(goals) {
  const container = document.getElementById('retirement-goals-card');
  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-msg">No retirement goals set yet. Set one per account on the <a href="retirement.html">Retirement page</a>.</div>';
    return;
  }
  container.innerHTML = goals
    .map((g) => {
      const pct = Math.min(g.progress_pct, 100);
      const goalLabel = g.goal_type === 'dollar' ? `${fmt(g.goal_amount)}/yr` : `${g.goal_amount}% of income`;
      const actualLabel =
        g.goal_type === 'dollar'
          ? `${fmt(g.contributed_this_year)} contributed`
          : `${g.actual_pct_of_income !== null ? g.actual_pct_of_income.toFixed(1) : '0'}% of income so far`;
      const over = g.progress_pct >= 100;
      return `
    <div class="goal-row">
      <div class="goal-top">
        <span class="goal-name">${g.name}</span>
        <span class="goal-target">${g.progress_pct.toFixed(0)}%</span>
      </div>
      <div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:${over ? 'var(--green)' : 'var(--blue)'}"></div></div>
      <div class="goal-meta">
        <span>${actualLabel}</span>
        <span>goal: ${goalLabel}</span>
      </div>
    </div>`;
    })
    .join('');
}

function renderDebtGoals(goals) {
  const container = document.getElementById('debt-goals-card');
  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-msg">No debt payoff targets set yet. Add a "debt-free by" date on the <a href="debt.html">Debt page</a>.</div>';
    return;
  }
  const statusLabel = {
    on_track: 'on track',
    behind: 'behind pace',
    paid_off: 'paid off',
    no_data: 'not enough data'
  };
  container.innerHTML = goals
    .map((g) => {
      let detail;
      if (g.status === 'paid_off') {
        detail = `Paid off! 🎉`;
      } else if (g.status === 'no_data') {
        detail = `Log at least two months of balances to see a projection.`;
      } else {
        detail = `${fmt(g.current_balance)} left · paying down ~${fmt(g.avg_monthly_paydown)}/mo · projected payoff ${g.projected_payoff_date}`;
      }
      return `
    <div class="debt-goal-card">
      <div class="debt-goal-top">
        <span class="debt-goal-name">${g.name}</span>
        <span class="status-badge status-${g.status}">${statusLabel[g.status]}</span>
      </div>
      <div class="debt-goal-detail">target: ${g.target_payoff_date} · ${detail}</div>
    </div>`;
    })
    .join('');
}

checkSession();
