export function ensureEmptySessionHint(container: HTMLElement): void {
  clearEmptySessionHint(container);
}

export function clearEmptySessionHint(container: HTMLElement): void {
  const existing = container.querySelector<HTMLDivElement>('.empty-session-hint');
  existing?.remove();
}
