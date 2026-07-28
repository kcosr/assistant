let hideTimer: ReturnType<typeof setTimeout> | null = null;

function getToastElement(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>('[data-role="app-toast"]');
  if (existing) {
    return existing;
  }

  const element = document.createElement('div');
  element.className = 'app-toast';
  element.dataset['role'] = 'app-toast';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  document.body.appendChild(element);
  return element;
}

export function showToast(message: string, durationMs = 2400): void {
  const text = message.trim();
  if (!text) {
    return;
  }

  const element = getToastElement();
  element.textContent = text;
  element.classList.add('is-visible');

  if (hideTimer) {
    clearTimeout(hideTimer);
  }
  hideTimer = setTimeout(() => {
    element.classList.remove('is-visible');
    hideTimer = null;
  }, durationMs);
}
