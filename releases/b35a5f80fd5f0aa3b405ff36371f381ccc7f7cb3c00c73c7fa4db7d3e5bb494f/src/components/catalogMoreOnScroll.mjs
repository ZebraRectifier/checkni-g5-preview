// Arm only after a deliberate scroll gesture, so layout changes and browser
// history restoration do not page through a catalogue in the background.
export function watchCatalogMore(button, loadMore) {
  const view = button.ownerDocument.defaultView;
  if (!view?.IntersectionObserver) return () => {};
  const events = new AbortController();
  const observer = new view.IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting) || !button.isConnected
        || button.hidden || button.disabled) return;
    stop();
    loadMore();
  });
  function stop() {
    events.abort();
    observer.disconnect();
  }
  function arm(event) {
    if (!button.isConnected) {
      stop();
      return;
    }
    if (event.type === 'wheel' && event.deltaY <= 0) return;
    observer.observe(button);
  }
  for (const type of ['wheel', 'touchmove']) {
    view.addEventListener(type, arm, { passive: true, signal: events.signal });
  }
  return stop;
}
