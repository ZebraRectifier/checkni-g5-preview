import { seedBodies, stepBodies } from './horiCubePhysics.mjs';

// Decorative only. One bounded field, no network/data/basket dependencies.
export function createHoriCubes(host, { toggleHost } = {}) {
  const document = host.ownerDocument;
  const view = document.defaultView;
  if (!view?.requestAnimationFrame || !view.cancelAnimationFrame || !view.matchMedia
    || !view.ResizeObserver || !view.IntersectionObserver || !view.MutationObserver
    || !view.performance?.now || !view.navigator || !view.location) return { destroy() {} };
  const existing = host.querySelector('.hori-cube-field');
  if (existing) return { destroy() {} };
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = view.matchMedia('(max-width: 899px)');
  if (!reduced?.addEventListener || !reduced.removeEventListener
    || !compact?.addEventListener || !compact.removeEventListener) return { destroy() {} };
  const shop = document.getElementById('shop-view');
  // The header owns its layout. Only append the owned button to its supplied
  // control slot; do not replace or restyle that slot's existing controls.
  const controls = toggleHost?.ownerDocument === document && typeof toggleHost.append === 'function' ? toggleHost : host;
  const field = document.createElement('div');
  field.className = 'hori-cube-field';
  field.setAttribute('aria-hidden', 'true');
  field.hidden = true;
  const toggle = document.createElement('button');
  toggle.className = controls === host ? 'hori-cube-toggle' : 'hori-cube-toggle hori-cube-toggle-inline';
  toggle.type = 'button'; toggle.hidden = true;
  host.append(field); controls.append(toggle);
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('./hori-cubes.css', import.meta.url).href;
  let ready = false, alive = true, visible = false, paused = false, raf = 0;
  let width = 0, height = 0, previousTime = null, lastPaint = null, accumulator = 0;
  let bodies = [], nodes = [], previous = [], phase = 0, expensive = 0, degraded = false;
  const storageKey = 'checkni.background-motion.v1';
  try { paused = view.localStorage.getItem(storageKey) === 'paused'; } catch { /* Tab-only pause is sufficient. */ }
  const smallDevice = (Number.isFinite(view.navigator.deviceMemory) && view.navigator.deviceMemory <= 4)
    || (Number.isFinite(view.navigator.hardwareConcurrency) && view.navigator.hardwareConcurrency <= 4);
  const minimalDevice = (Number.isFinite(view.navigator.deviceMemory) && view.navigator.deviceMemory <= 2)
    || (Number.isFinite(view.navigator.hardwareConcurrency) && view.navigator.hardwareConcurrency <= 2);
  const count = () => Math.min(compact.matches ? 6 : 10, minimalDevice ? 4 : smallDevice ? 6 : 10, degraded ? 4 : 10);
  const inShop = () => view.location.hash !== '#basket' && !shop?.hidden;
  const resetClock = () => { previousTime = null; lastPaint = null; accumulator = 0; };
  const canRun = () => alive && ready && !paused && !reduced.matches && visible
    && inShop() && !document.hidden && width > 0 && height > 0 && host.isConnected && controls.isConnected;
  const stop = () => {
    if (raf) view.cancelAnimationFrame(raf);
    raf = 0; resetClock(); field.dataset.running = 'false';
  };
  function label() {
    toggle.textContent = paused ? 'Включить фон' : 'Пауза фона';
    toggle.setAttribute('aria-label', paused ? 'Включить анимацию фона' : 'Остановить анимацию фона');
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.hidden = !ready || reduced.matches || !inShop();
  }
  function paint(alpha = 1) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], p = previous[i] || b;
      const x = p.x + (b.x - p.x) * alpha, y = p.y + (b.y - p.y) * alpha;
      nodes[i].style.transform = `translate3d(${(x - b.size / 2).toFixed(2)}px,${(y - b.size / 2).toFixed(2)}px,0)`;
      nodes[i].firstElementChild.style.transform = `rotateX(${(-24 + Math.sin(phase + b.angle) * 8).toFixed(2)}deg) rotateY(${(30 + Math.sin(phase * .7 + b.angle) * 12).toFixed(2)}deg)`;
    }
  }
  function rebuild() {
    bodies = reduced.matches || !width || !height ? [] : seedBodies(count(), width, height);
    previous = bodies.map(b => ({ x: b.x, y: b.y }));
    nodes = bodies.map(b => {
      const node = document.createElement('span'); node.className = 'hori-cube';
      node.style.setProperty('--cube-size', `${b.size.toFixed(2)}px`);
      const solid = document.createElement('span'); solid.className = 'hori-cube-solid';
      for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
        const side = document.createElement('span'); side.className = `hori-cube-face hori-cube-${face}`; solid.append(side);
      }
      node.append(solid); return node;
    });
    field.replaceChildren(...nodes); field.dataset.cubeCount = String(bodies.length);
    resetClock(); paint();
  }
  function sync() {
    field.hidden = !ready || reduced.matches || !inShop();
    label();
    if (!canRun()) { stop(); return; }
    if (!raf) { resetClock(); raf = view.requestAnimationFrame(tick); }
  }
  function tick(time) {
    raf = 0;
    if (!canRun()) { stop(); return; }
    if (field.dataset.running !== 'true') field.dataset.running = 'true';
    if (previousTime === null) previousTime = time;
    accumulator += Math.max(0, Math.min(.05, (time - previousTime) / 1000));
    previousTime = time;
    const start = view.performance.now();
    let steps = 0;
    while (accumulator >= 1 / 60 && steps < 3) {
      for (let i = 0; i < bodies.length; i++) { previous[i].x = bodies[i].x; previous[i].y = bodies[i].y; }
      stepBodies(bodies, width, height, 1 / 60);
      accumulator -= 1 / 60; phase += 1 / 60 * .12; steps++;
    }
    if (lastPaint === null || time - lastPaint >= 1000 / 30 - .1) {
      paint(Math.min(1, accumulator * 60)); lastPaint = time;
      // Measure only this field's work, not unrelated network/browser delays.
      // A sustained expensive field drops to four cubes; never upgrades mid-session.
      expensive = view.performance.now() - start > 4 ? expensive + 1 : Math.max(0, expensive - 1);
      if (!degraded && expensive >= 45) {
        degraded = true;
        const keep = count();
        for (const node of nodes.splice(keep)) node.remove();
        bodies.length = Math.min(bodies.length, keep); previous.length = bodies.length;
        field.dataset.cubeCount = String(bodies.length);
        // Keep the remaining positions and phase; no reseed or visible jump.
        expensive = 0;
      }
    }
    raf = view.requestAnimationFrame(tick);
  }
  function resize() {
    if (!alive || !ready) return;
    const w = field.clientWidth, h = field.clientHeight;
    if (w === width && h === height && bodies.length === (reduced.matches || !w || !h ? 0 : count())) { sync(); return; }
    const oldWidth = width, oldHeight = height; width = w; height = h;
    if (!width || !height || !oldWidth || !oldHeight || bodies.length !== (reduced.matches ? 0 : count())) rebuild();
    else {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        const rx = Math.min(b.r, width / 2), ry = Math.min(b.r, height / 2);
        b.x = Math.max(rx, Math.min(width - rx, b.x * width / oldWidth));
        b.y = Math.max(ry, Math.min(height - ry, b.y * height / oldHeight));
        previous[i].x = b.x; previous[i].y = b.y;
      }
      resetClock(); paint();
    }
    sync();
  }
  function onMotionChange() { rebuild(); resize(); sync(); }
  function onToggle() {
    paused = !paused;
    try { view.localStorage.setItem(storageKey, paused ? 'paused' : 'running'); } catch { /* Preserve current tab. */ }
    sync();
  }
  const resizeObserver = new view.ResizeObserver(resize);
  const intersectionObserver = new view.IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting); sync();
  }, { threshold: 0 });
  const onVisibility = () => sync();
  const onPageHide = () => stop();
  const onPageShow = () => sync();
  // pushState itself emits no hashchange. Observe the existing view owner;
  // never patch history or add a second navigation/state writer.
  const routeObserver = shop ? new view.MutationObserver(() => sync()) : null;
  routeObserver?.observe(shop, { attributes: true, attributeFilter: ['hidden'] });
  const onLoad = () => {
    if (!alive) return;
    ready = true; field.hidden = reduced.matches;
    resizeObserver.observe(field); intersectionObserver.observe(host);
    resize(); sync();
  };
  sheet.addEventListener('load', onLoad, { once: true });
  sheet.addEventListener('error', stop, { once: true });
  document.head.append(sheet);
  toggle.addEventListener('click', onToggle);
  document.addEventListener('visibilitychange', onVisibility);
  view.addEventListener('pagehide', onPageHide);
  view.addEventListener('pageshow', onPageShow);
  view.addEventListener('hashchange', onVisibility);
  reduced.addEventListener('change', onMotionChange);
  compact.addEventListener('change', resize);
  return Object.freeze({ destroy() {
    if (!alive) return; alive = false; stop();
    resizeObserver.disconnect(); intersectionObserver.disconnect(); routeObserver?.disconnect();
    toggle.removeEventListener('click', onToggle);
    document.removeEventListener('visibilitychange', onVisibility);
    view.removeEventListener('pagehide', onPageHide); view.removeEventListener('pageshow', onPageShow);
    view.removeEventListener('hashchange', onVisibility);
    reduced.removeEventListener('change', onMotionChange); compact.removeEventListener('change', resize);
    sheet.removeEventListener('load', onLoad); sheet.removeEventListener('error', stop);
    field.remove(); toggle.remove(); sheet.remove(); bodies = []; nodes = []; previous = [];
  } });
}
