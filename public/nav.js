(function () {
  var NAV_ITEMS = [
    { href: 'index.html', icon: '🏠', label: 'Dashboard' },
    { href: 'averages.html', icon: '📊', label: 'Averages' },
    { href: 'debt.html', icon: '💳', label: 'Debt' },
    { href: 'savings.html', icon: '💰', label: 'Savings' },
    { href: 'yearly.html', icon: '📅', label: 'Yearly' },
    { href: 'bills.html', icon: '🧾', label: 'Bills' }
  ];

  var current = window.location.pathname.split('/').pop() || 'index.html';

  var nav = document.createElement('nav');
  nav.className = 'topnav';
  nav.innerHTML = NAV_ITEMS.map(function (item) {
    var active = item.href === current ? ' active' : '';
    return '<a href="' + item.href + '" class="topnav-item' + active + '">' +
      '<span class="topnav-icon">' + item.icon + '</span>' +
      '<span class="topnav-label">' + item.label + '</span></a>';
  }).join('');

  var mount = document.getElementById('topnav-mount');
  if (mount) mount.replaceWith(nav);
})();
