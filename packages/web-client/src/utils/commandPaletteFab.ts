export interface CommandPaletteFabOptions {
  button: HTMLButtonElement | null;
  icon?: string;
  openCommandPalette: () => void;
  isMobileViewport: () => boolean;
  isCapacitorAndroid?: () => boolean;
}

export function setupCommandPaletteFab(options: CommandPaletteFabOptions): () => void {
  const button = options.button;
  if (!button) {
    return () => undefined;
  }

  if (typeof options.icon === 'string') {
    button.innerHTML = options.icon;
  }

  const handleClick = () => {
    options.openCommandPalette();
  };

  button.addEventListener('click', handleClick);

  const updateVisibility = (): void => {
    const shouldShow =
      options.isMobileViewport() || (options.isCapacitorAndroid?.() ?? false);
    button.classList.toggle('is-visible', shouldShow);
  };

  updateVisibility();

  if (typeof window === 'undefined') {
    return () => {
      button.removeEventListener('click', handleClick);
    };
  }

  const handleResize = () => updateVisibility();
  window.addEventListener('resize', handleResize);

  return () => {
    window.removeEventListener('resize', handleResize);
    button.removeEventListener('click', handleClick);
  };
}
