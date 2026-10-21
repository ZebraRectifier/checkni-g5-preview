import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoriCubes } from '../src/components/HoriCubes.mjs';

// This fixture models lifecycle signals and the DOM API used by the component.
// It does not claim to model layout, rendering performance or an Android device.
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ callback, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback));
  }
  dispatch(type) {
    for (const item of [...(this.listeners.get(type) || [])]) {
      if (item.once) this.removeEventListener(type, item.callback);
      item.callback({ type, target: this });
    }
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.length, 0);
  }
}

class Element extends Events {
  constructor(tagName, document) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.hidden = false;
    this.className = '';
    this.textContent = '';
    this.value = '';
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      this.children.push(child);
      child.parentElement = this;
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get firstElementChild() { return this.children[0] || null; }
  get isConnected() { return Boolean(this.root || this.parentElement?.isConnected); }
  get rendered() { return !this.hidden && (!this.parentElement || this.parentElement.rendered); }
  get clientWidth() { return this.rendered ? this.ownerDocument.bounds.width : 0; }
  get clientHeight() { return this.rendered ? this.ownerDocument.bounds.height : 0; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (selector.startsWith('.') && child.className.split(/\s+/).includes(selector.slice(1))) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}

function fixture({ compact = false, reduced = false, memory = 8, cores = 8, storage = new Map(), hash = '', separateToggleHost = false, beforeMount = () => {} } = {}) {
  const document = new Events();
  document.hidden = false;
  document.bounds = { width: compact ? 350 : 900, height: separateToggleHost ? compact ? 48 : 56 : 300 };
  document.createElement = name => new Element(name, document);
  document.head = document.createElement('head'); document.head.root = true;
  document.body = document.createElement('body'); document.body.root = true;
  const shop = document.createElement('section'); shop.id = 'shop-view';
  document.getElementById = id => id === shop.id ? shop : null;
  const section = document.createElement('section');
  const input = document.createElement('input'); input.value = 'кефир';
  let searchEvents = 0;
  input.addEventListener('input', () => searchEvents++);
  section.append(input); document.body.append(section, shop);
  const controls = separateToggleHost ? document.createElement('div') : section;
  const existingControl = separateToggleHost ? document.createElement('button') : null;
  if (separateToggleHost) {
    section.className = 'pixel-motion-host'; controls.className = 'pixel-motion-controls';
    existingControl.textContent = 'Тема'; controls.append(existingControl); document.body.append(controls);
  }
  const mountOptions = separateToggleHost ? { toggleHost: controls } : {};
  const view = new Events();
  document.defaultView = view;
  view.navigator = { deviceMemory: memory, hardwareConcurrency: cores };
  view.location = { hash };
  view.history = {
    pushState(_state, _unused, url) {
      // Like the browser History API, this changes the URL without hashchange.
      view.location.hash = new URL(url, 'https://example.test/').hash;
    }
  };
  view.performance = { now: () => 0 };
  view.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  const reducedMedia = Object.assign(new Events(), { matches: reduced });
  const compactMedia = Object.assign(new Events(), { matches: compact });
  view.matchMedia = query => query.includes('reduced-motion') ? reducedMedia : compactMedia;
  const frames = new Map(); let nextFrame = 1;
  view.requestAnimationFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id; };
  view.cancelAnimationFrame = id => frames.delete(id);
  const resizeObservers = [], intersectionObservers = [], mutationObservers = [];
  function observerClass(collection) {
    return class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); collection.push(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    };
  }
  view.ResizeObserver = observerClass(resizeObservers);
  view.IntersectionObserver = observerClass(intersectionObservers);
  view.MutationObserver = observerClass(mutationObservers);
  beforeMount({ view, reducedMedia, compactMedia });
  let controller = createHoriCubes(section, mountOptions);
  const getField = () => section.querySelector('.hori-cube-field');
  const getToggle = () => controls.querySelector('.hori-cube-toggle');
  const load = () => document.head.children.at(-1).dispatch('load');
  const intersect = visible => {
    for (const observer of intersectionObservers) if (observer.targets.has(section)) observer.callback([{ target: section, isIntersecting: visible }]);
  };
  const resize = () => {
    for (const observer of resizeObservers) if (observer.targets.size) observer.callback();
  };
  return {
    document, view, section, controls, existingControl, shop, input, storage, frames, reducedMedia, compactMedia,
    resizeObservers, intersectionObservers, mutationObservers, load, intersect, resize,
    get field() { return getField(); }, get toggle() { return getToggle(); },
    get controller() { return controller; }, get searchEvents() { return searchEvents; },
    mount() { controller = createHoriCubes(section, mountOptions); return controller; },
    frame(time) {
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(time);
    },
    setReduced(value) { reducedMedia.matches = value; reducedMedia.dispatch('change'); resize(); },
    setCompact(value) { compactMedia.matches = value; compactMedia.dispatch('change'); resize(); },
    setHidden(value) { document.hidden = value; document.dispatch('visibilitychange'); },
    route(value) { view.location.hash = value; view.dispatch('hashchange'); resize(); },
    deliverShopMutation() {
      for (const observer of mutationObservers) if (observer.targets.has(shop)) observer.callback([{ target: shop, type: 'attributes', attributeName: 'hidden' }]);
    }
  };
}

test('unsupported decorative capabilities leave the shopping controls untouched', () => {
  const variations = [
    ({ view }) => { delete view.matchMedia; },
    ({ view }) => { delete view.MutationObserver; },
    ({ view }) => { delete view.cancelAnimationFrame; },
    ({ view }) => { delete view.performance; },
    ({ reducedMedia }) => { reducedMedia.addEventListener = undefined; },
    ({ compactMedia }) => { compactMedia.removeEventListener = undefined; }
  ];
  for (const beforeMount of variations) {
    const f = fixture({ beforeMount });
    assert.equal(f.field, null);
    assert.equal(f.toggle, null);
    assert.equal(f.document.head.children.length, 0);
    assert.equal(f.frames.size, 0);
    assert.equal(f.input.value, 'кефир');
    f.input.dispatch('input'); assert.equal(f.searchEvents, 1);
    assert.doesNotThrow(() => f.controller.destroy());
  }
});

test('render writes stay capped and an expensive field retains its first four cubes', () => {
  const f = fixture(); f.load(); f.intersect(true);
  const initial = f.field.querySelectorAll('.hori-cube');
  let costClock = 0, writes = 0, transform = initial[0].style.transform;
  f.view.performance.now = () => { costClock += 5; return costClock; };
  Object.defineProperty(initial[0].style, 'transform', {
    get: () => transform, set: value => { transform = value; writes++; }, configurable: true
  });
  for (let frame = 0; frame <= 240; frame++) f.frame(frame * 1000 / 60);
  assert.ok(writes <= 121, 'four seconds should not exceed the 30Hz paint ceiling');
  assert.equal(f.field.querySelectorAll('.hori-cube').length, 4);
  assert.deepEqual(f.field.querySelectorAll('.hori-cube'), initial.slice(0, 4));
  assert.equal(f.frames.size, 1);
  f.controller.destroy(); assert.equal(f.frames.size, 0);
});

test('motion waits for stylesheet and visibility; repeated signals keep one animation loop', () => {
  const f = fixture();
  assert.equal(f.frames.size, 0);
  assert.equal(f.field.hidden, true);
  assert.equal(f.field.children.length, 0);
  f.load();
  assert.equal(f.frames.size, 0);
  assert.equal(f.field.children.length, 10);
  f.intersect(true);
  assert.equal(f.frames.size, 1);
  f.intersect(true); f.resize(); f.setHidden(false);
  assert.equal(f.frames.size, 1);
  const initial = f.field.children.map(node => node.style.transform);
  for (let time = 0; time <= 1000; time += 1000 / 60) f.frame(time);
  assert.equal(f.frames.size, 1);
  assert.ok(f.field.children.some((node, index) => node.style.transform !== initial[index]));
  assert.equal(f.field.getAttribute('aria-hidden'), 'true');
  assert.ok(f.field.children.every(node => node.children.length === 1 && node.firstElementChild.children.length === 6));
  assert.equal(f.section.children.filter(node => node.className === 'hori-cube-field').length, 1);
  assert.equal(f.input.value, 'кефир');
  f.input.dispatch('input');
  assert.equal(f.searchEvents, 1);
  f.controller.destroy();
});

test('phone and constrained devices stay within their DOM budgets across resize', () => {
  for (const [options, expected] of [
    [{}, 10], [{ compact: true }, 6], [{ memory: 4 }, 6], [{ cores: 4 }, 6],
    [{ memory: 2 }, 4], [{ cores: 2 }, 4], [{ compact: true, memory: 2 }, 4]
  ]) {
    const f = fixture(options); f.load(); f.intersect(true);
    assert.equal(f.field.children.length, expected);
    assert.equal(f.field.querySelectorAll('.hori-cube-face').length, expected * 6);
    f.document.bounds.width = 300; f.setCompact(true);
    assert.ok(f.field.children.length <= Math.min(expected, 6));
    assert.equal(f.frames.size, 1);
    f.document.bounds.width = 1200; f.setCompact(false);
    assert.equal(f.field.children.length, options.memory <= 2 || options.cores <= 2 ? 4 : options.memory <= 4 || options.cores <= 4 ? 6 : 10);
    assert.equal(f.frames.size, 1);
    f.controller.destroy();
  }
});

test('manual pause survives destroy/remount and can be explicitly resumed', () => {
  const f = fixture(); f.load(); f.intersect(true);
  f.toggle.dispatch('click');
  assert.equal(f.frames.size, 0);
  assert.equal(f.toggle.getAttribute('aria-pressed'), 'true');
  f.controller.destroy(); f.mount(); f.load(); f.intersect(true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.toggle.getAttribute('aria-pressed'), 'true');
  f.toggle.dispatch('click');
  assert.equal(f.frames.size, 1);
  assert.equal(f.toggle.getAttribute('aria-pressed'), 'false');
  f.controller.destroy();
});

test('separate header slots preserve existing controls and destroy only owned nodes', () => {
  const f = fixture({ compact: true, separateToggleHost: true });
  let themeClicks = 0;
  f.existingControl.addEventListener('click', () => themeClicks++);
  f.load(); f.intersect(true);
  assert.equal(f.field.parentElement, f.section);
  assert.equal(f.toggle.parentElement, f.controls);
  assert.equal(f.section.querySelector('.hori-cube-toggle'), null);
  assert.equal(f.controls.querySelector('.hori-cube-field'), null);
  assert.equal(f.field.children.length, 6);
  assert.equal(f.field.querySelectorAll('.hori-cube-face').length, 36);
  assert.equal(f.controls.children[0], f.existingControl);
  assert.equal(f.controls.className, 'pixel-motion-controls');
  const duplicate = createHoriCubes(f.section, { toggleHost: f.controls });
  duplicate.destroy();
  assert.equal(f.controls.querySelectorAll('.hori-cube-toggle').length, 1);
  assert.equal(f.frames.size, 1);
  f.toggle.dispatch('click'); assert.equal(f.frames.size, 0);
  f.controller.destroy(); f.mount(); f.load(); f.intersect(true);
  assert.equal(f.frames.size, 0, 'the existing pause preference also applies to a separate slot');
  f.toggle.dispatch('click'); assert.equal(f.frames.size, 1);
  f.controller.destroy();
  assert.deepEqual(f.controls.children, [f.existingControl]);
  f.existingControl.dispatch('click'); assert.equal(themeClicks, 1);
  assert.equal(f.input.value, 'кефир');
  assert.equal(f.frames.size, 0);
  assert.equal(f.document.listenerCount + f.view.listenerCount + f.reducedMedia.listenerCount + f.compactMedia.listenerCount, 0);
  assert.ok([...f.resizeObservers, ...f.intersectionObservers, ...f.mutationObservers].every(observer => observer.targets.size === 0));
});

test('header motion resumes without a hidden-time jump and stops if its control slot disappears', () => {
  const f = fixture({ separateToggleHost: true }); f.load(); f.intersect(true);
  f.frame(0); f.frame(1000 / 60); f.frame(1000 / 30);
  const point = node => node.style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px/).slice(1).map(Number);
  const beforePause = f.field.children.map(point);
  f.setHidden(true); assert.equal(f.frames.size, 0);
  f.frame(1_000_000);
  f.setHidden(false); assert.equal(f.frames.size, 1);
  f.frame(1_000_000);
  for (const [index, node] of f.field.children.entries()) {
    const after = point(node), before = beforePause[index];
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1,
      'resuming must not integrate the hidden interval');
  }
  f.intersect(false); assert.equal(f.frames.size, 0);
  f.intersect(true); assert.equal(f.frames.size, 1);
  f.setReduced(true); assert.equal(f.frames.size, 0); assert.equal(f.toggle.hidden, true);
  f.setReduced(false); assert.equal(f.frames.size, 1);
  f.view.history.pushState(null, '', '#basket');
  f.shop.hidden = true; f.deliverShopMutation();
  assert.equal(f.frames.size, 0); assert.equal(f.toggle.hidden, true);
  f.view.history.pushState(null, '', '/');
  f.shop.hidden = false; f.deliverShopMutation(); f.resize();
  assert.equal(f.frames.size, 1); assert.equal(f.toggle.hidden, false);
  f.controls.remove(); f.frame(1_000_034);
  assert.equal(f.frames.size, 0, 'motion must stop when the pause control is disconnected');
  f.document.body.append(f.controls); f.setHidden(false);
  assert.equal(f.frames.size, 1);
  f.controller.destroy(); assert.equal(f.frames.size, 0);
});

test('hidden, offscreen, basket and reduced-motion states stop all scheduled frames', () => {
  const f = fixture(); f.load(); f.intersect(true);
  f.setHidden(true); assert.equal(f.frames.size, 0);
  f.setHidden(false); assert.equal(f.frames.size, 1);
  f.intersect(false); assert.equal(f.frames.size, 0);
  f.intersect(true); assert.equal(f.frames.size, 1);
  f.route('#basket');
  assert.equal(f.frames.size, 0); assert.equal(f.field.hidden, true); assert.equal(f.toggle.hidden, true);
  f.route('');
  assert.equal(f.frames.size, 1); assert.equal(f.field.hidden, false);
  f.setReduced(true);
  assert.equal(f.frames.size, 0); assert.equal(f.field.children.length, 0);
  assert.equal(f.field.hidden, true); assert.equal(f.toggle.hidden, true);
  f.setReduced(false);
  assert.equal(f.frames.size, 1); assert.equal(f.field.children.length, 10);
  f.view.dispatch('pagehide'); assert.equal(f.frames.size, 0);
  f.view.dispatch('pageshow'); assert.equal(f.frames.size, 1);
  f.controller.destroy();
});

test('starting in reduced motion creates no cube DOM or frames until the preference changes', () => {
  const f = fixture({ reduced: true }); f.load(); f.intersect(true);
  assert.equal(f.frames.size, 0); assert.equal(f.field.children.length, 0);
  assert.equal(f.toggle.hidden, true);
  f.setReduced(false);
  assert.equal(f.frames.size, 1); assert.equal(f.field.children.length, 10);
  f.controller.destroy();
});

test('pushState routes stop motion through shop visibility without a hashchange event', () => {
  const f = fixture(); f.load(); f.intersect(true);
  let hashChanges = 0;
  const onHashChange = () => hashChanges++;
  f.view.addEventListener('hashchange', onHashChange);
  f.view.history.pushState(null, '', '#basket');
  f.shop.hidden = true; f.deliverShopMutation();
  assert.equal(hashChanges, 0);
  assert.equal(f.frames.size, 0); assert.equal(f.field.hidden, true); assert.equal(f.toggle.hidden, true);
  // Return through the existing route owner; no synthetic hashchange is sent.
  f.view.history.pushState(null, '', '/');
  f.shop.hidden = false; f.deliverShopMutation(); f.resize();
  assert.equal(hashChanges, 0);
  assert.equal(f.frames.size, 1); assert.equal(f.field.hidden, false); assert.equal(f.toggle.hidden, false);
  // The view owner remains sufficient even if its URL does not use #basket.
  f.shop.hidden = true; f.deliverShopMutation();
  assert.equal(f.frames.size, 0); assert.equal(f.field.hidden, true);
  f.view.removeEventListener('hashchange', onHashChange);
  f.controller.destroy();
  assert.ok(f.mutationObservers.every(observer => observer.targets.size === 0));
  f.shop.hidden = false; f.deliverShopMutation();
  assert.equal(f.frames.size, 0);
});

test('zero-sized hosts pause; resized hosts resume without replacing search controls', () => {
  const f = fixture(); f.load(); f.intersect(true);
  const originalInput = f.input;
  f.document.bounds = { width: 0, height: 0 }; f.resize();
  assert.equal(f.frames.size, 0); assert.equal(f.field.children.length, 0);
  f.document.bounds = { width: 240, height: 90 }; f.resize();
  assert.equal(f.frames.size, 1); assert.equal(f.field.children.length, 10);
  assert.equal(f.section.children[0], originalInput);
  assert.equal(originalInput.value, 'кефир');
  assert.ok(f.field.children.every(node => !/NaN|Infinity/.test(node.style.transform)));
  f.controller.destroy();
});

test('destroy removes its nodes, observers and listeners; a clean remount owns one loop', () => {
  const f = fixture(); f.load(); f.intersect(true);
  const firstController = f.controller;
  const duplicate = createHoriCubes(f.section);
  duplicate.destroy();
  assert.equal(f.section.querySelectorAll('.hori-cube-field').length, 1);
  assert.equal(f.frames.size, 1);
  firstController.destroy(); firstController.destroy();
  assert.equal(f.frames.size, 0); assert.equal(f.field, null); assert.equal(f.toggle, null);
  assert.equal(f.document.head.children.length, 0);
  assert.equal(f.document.listenerCount + f.view.listenerCount + f.reducedMedia.listenerCount + f.compactMedia.listenerCount, 0);
  assert.ok([...f.resizeObservers, ...f.intersectionObservers, ...f.mutationObservers].every(observer => observer.targets.size === 0));
  f.mount(); f.load(); f.intersect(true);
  assert.equal(f.section.querySelectorAll('.hori-cube-field').length, 1);
  assert.equal(f.frames.size, 1);
  f.controller.destroy();
  assert.equal(f.frames.size, 0);
});

test('destroy before stylesheet load cannot resurrect the field', () => {
  const f = fixture();
  const sheet = f.document.head.children[0];
  f.controller.destroy(); sheet.dispatch('load');
  f.intersect(true); f.setHidden(false); f.setReduced(true); f.resize();
  assert.equal(f.frames.size, 0); assert.equal(f.field, null);
  assert.equal(sheet.listenerCount, 0);
});
