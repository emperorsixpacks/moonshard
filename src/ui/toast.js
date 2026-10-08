/** Lightweight global toast for network / verification states. */
let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.id = 'ms-toast-container';
    container.className = 'ms-toast-container';
    (document.getElementById('ms-fx') || document.body).appendChild(container);
  }
  return container;
}

/**
 * Show a transient message. `type` is one of 'info' | 'error' | 'warn'.
 * Returns a dismiss function.
 */
export function showToast(message, { type = 'info', duration = 5000, sticky = false } = {}) {
  const host = ensureContainer();
  const el = document.createElement('div');
  el.className = `ms-toast ms-toast-${type}`;
  el.textContent = String(message ?? '');
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  const dismiss = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  if (!sticky) {
    setTimeout(dismiss, duration);
    el.addEventListener('click', dismiss);
  }
  return dismiss;
}