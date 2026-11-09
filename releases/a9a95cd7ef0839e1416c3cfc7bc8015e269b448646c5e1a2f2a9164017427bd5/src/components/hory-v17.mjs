// Presentation observes the existing flow's semantic mascot state. It never
// advances a search or claims success on a timer.
const states = {
  idle: 'idle', sleeping: 'idle', curious: 'clarify', partial: 'clarify',
  error: 'clarify', searching: 'searching', checking: 'thinking',
  found: 'found', big_saving: 'found'
};

export function mountHoryV17({ document }) {
  const dialog = document.getElementById('pixel-hory-dialog');
  if (!dialog || dialog.dataset.horyV17) return;
  dialog.dataset.horyV17 = 'true';
  const input = document.getElementById('basket-proposal-input');
  const stage = document.querySelector('.hero-identity');
  const portraits = [];
  for (const image of document.querySelectorAll('.pixel-hory-avatar, .pixel-hory-identity > img')) {
    const portrait = document.createElement('span');
    portrait.className = 'hory-v17-sprite';
    portrait.setAttribute('aria-hidden', 'true');
    image.replaceWith(portrait);
    portraits.push(portrait);
  }
  const welcome = dialog.querySelector('.shopping-welcome');
  if (welcome) {
    const portrait = document.createElement('span');
    portrait.className = 'hory-v17-sprite hory-v17-welcome';
    portrait.setAttribute('aria-hidden', 'true');
    welcome.prepend(portrait);
    portraits.push(portrait);
  }
  let semanticState = stage?.dataset.mascotState || 'idle';
  function paint() {
    const state = states[semanticState] || 'idle';
    const listening = state === 'idle' && document.activeElement === input;
    for (const portrait of portraits) portrait.dataset.state = listening ? 'listening' : state;
    dialog.dataset.horyState = state;
  }
  const observer = new document.defaultView.MutationObserver(() => {
    semanticState = stage.dataset.mascotState || 'idle';
    paint();
  });
  if (stage) observer.observe(stage, { attributes: true, attributeFilter: ['data-mascot-state'] });
  input?.addEventListener('focus', paint);
  input?.addEventListener('blur', paint);
  paint();
  return {
    update(state) { semanticState = state; paint(); },
    destroy() {
      observer.disconnect();
      input?.removeEventListener('focus', paint);
      input?.removeEventListener('blur', paint);
    }
  };
}
