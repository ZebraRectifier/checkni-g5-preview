(() => {
  const retail = location.hostname === 'zebrarectifier.github.io'
    || location.hostname.endsWith('.vercel.app')
    || new URLSearchParams(location.search).get('catalog') === 'retail';
  if (!retail) return;
  document.documentElement.dataset.checkniBoot = 'loading';
  let theme = 'light';
  try {
    const saved = localStorage.getItem('checkni.appearance.v1');
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch {}
  document.documentElement.dataset.horiTheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#292333' : '#e9e6f0');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  function showLoadFailure() {
    if (document.documentElement.dataset.checkniBoot !== 'loading') return;
    const boot = document.getElementById('checkni-boot');
    if (!boot || boot.querySelector('button')) return;
    boot.querySelector('span').textContent = 'Не удалось открыть магазины. Проверь подключение и повтори.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Повторить';
    retry.addEventListener('click', () => location.reload());
    boot.append(retry);
  }
  window.addEventListener('error', event => {
    if (event.target instanceof HTMLScriptElement) showLoadFailure();
  }, true);
  window.setTimeout(showLoadFailure, 20000);
})();
