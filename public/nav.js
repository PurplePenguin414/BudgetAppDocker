(function () {
  // ---------- Apply saved theme as early as possible to minimize flash ----------
  var savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  // ---------- Inject dark theme variable overrides ----------
  // Appended to <head>, so it comes after each page's own inline <style> block
  // in DOM order and wins the cascade for matching variable names.
  var darkStyle = document.createElement('style');
  darkStyle.id = 'dark-theme-vars';
  darkStyle.textContent = [
    ':root[data-theme="dark"] {',
    '  --bg: #171614;',
    '  --surface: #221f1c;',
    '  --surface2: #2b2825;',
    '  --border: rgba(255,255,255,0.10);',
    '  --text: #f1efe9;',
    '  --muted: #9a9690;',
    '  --red: #e2665a;',
    '  --red-bg: #3a211e;',
    '  --amber: #d99a3f;',
    '  --amber-bg: #3a2e1a;',
    '  --green: #4bb388;',
    '  --green-bg: #1c332a;',
    '  --blue: #5b93cf;',
    '  --blue-bg: #1e2c3a;',
    '}',
    ':root[data-theme="dark"] img { filter: brightness(0.92); }',
    'body { transition: background-color 0.2s ease, color 0.2s ease; }',
    '.card, .metric, .chart-wrap, input, select, textarea, .topnav-item { transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease; }'
  ].join('\n');
  document.head.appendChild(darkStyle);

  // ---------- Build nav bar ----------
  var NAV_STRUCTURE = [
    { type: 'link', href: 'index.html', icon: '🏠', label: 'Dashboard' },
    { type: 'link', href: 'goals.html', icon: '🎯', label: 'Goals' },
    { type: 'link', href: 'averages.html', icon: '📊', label: 'Averages' },
    { type: 'link', href: 'yearly.html', icon: '📅', label: 'Yearly' },
    {
      type: 'dropdown',
      icon: '💼',
      label: 'Accounts',
      items: [
        { href: 'debt.html', icon: '💳', label: 'Debt' },
        { href: 'savings.html', icon: '💰', label: 'Savings' },
        { href: 'retirement.html', icon: '🏦', label: 'Retirement' },
        { href: 'bills.html', icon: '🧾', label: 'Bills' }
      ]
    }
  ];

  var current = window.location.pathname.split('/').pop() || 'index.html';

  function isGroupActive(items) {
    return items.some(function (item) { return item.href === current; });
  }

  var nav = document.createElement('nav');
  nav.className = 'topnav';

  var scrollArea = document.createElement('div');
  scrollArea.className = 'topnav-scroll';

  NAV_STRUCTURE.forEach(function (entry) {
    if (entry.type === 'link') {
      var active = entry.href === current ? ' active' : '';
      var a = document.createElement('a');
      a.href = entry.href;
      a.className = 'topnav-item' + active;
      a.innerHTML = '<span class="topnav-icon">' + entry.icon + '</span><span class="topnav-label">' + entry.label + '</span>';
      scrollArea.appendChild(a);
    } else {
      var groupActive = isGroupActive(entry.items) ? ' active' : '';
      var wrap = document.createElement('div');
      wrap.className = 'topnav-dropdown-wrap';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'topnav-item topnav-dropdown-btn' + groupActive;
      btn.innerHTML = '<span class="topnav-icon">' + entry.icon + '</span><span class="topnav-label">' + entry.label + '</span><span class="topnav-caret">▾</span>';

      var menu = document.createElement('div');
      menu.className = 'topnav-dropdown-menu';
      menu.innerHTML = entry.items.map(function (item) {
        var itemActive = item.href === current ? ' active' : '';
        return '<a href="' + item.href + '" class="topnav-dropdown-item' + itemActive + '">' +
          '<span class="topnav-icon">' + item.icon + '</span>' +
          '<span class="topnav-label">' + item.label + '</span></a>';
      }).join('');

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = menu.classList.contains('open');
        document.querySelectorAll('.topnav-dropdown-menu.open').forEach(function (m) { m.classList.remove('open'); });
        if (!wasOpen) menu.classList.add('open');
      });

      wrap.appendChild(btn);
      wrap.appendChild(menu);
      scrollArea.appendChild(wrap);
    }
  });

  document.addEventListener('click', function () {
    document.querySelectorAll('.topnav-dropdown-menu.open').forEach(function (m) { m.classList.remove('open'); });
  });

  nav.appendChild(scrollArea);

  var toggleBtn = document.createElement('button');
  toggleBtn.className = 'topnav-item topnav-theme-toggle';
  toggleBtn.type = 'button';
  toggleBtn.innerHTML = '<span class="topnav-icon">' + (savedTheme === 'dark' ? '☀️' : '🌙') + '</span>' +
    '<span class="topnav-label">' + (savedTheme === 'dark' ? 'Light' : 'Dark') + '</span>';
  toggleBtn.addEventListener('click', function () {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      toggleBtn.innerHTML = '<span class="topnav-icon">🌙</span><span class="topnav-label">Dark</span>';
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      toggleBtn.innerHTML = '<span class="topnav-icon">☀️</span><span class="topnav-label">Light</span>';
    }
  });
  nav.appendChild(toggleBtn);

  var mount = document.getElementById('topnav-mount');
  if (mount) mount.replaceWith(nav);
})();
