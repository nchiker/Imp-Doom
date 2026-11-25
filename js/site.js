/* Theme toggle (same behaviour as the Leap IDE pages): remembers the choice in localStorage when it can. */
(function () {
  var b = document.getElementById('theme'), root = document.documentElement;
  if (!b) return;
  function dark() { return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
  function label() { b.textContent = dark() ? '☀' : '☾'; }
  b.addEventListener('click', function () {
    root.dataset.theme = dark() ? 'light' : 'dark';
    try { localStorage.setItem('imp-doom-site.theme', root.dataset.theme); } catch (e) {}
    label();
  });
  label();
})();
