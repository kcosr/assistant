export interface SettingsDropdownControllerOptions {
  dropdown: HTMLElement | null;
  toggleButton: HTMLElement;
}

export class SettingsDropdownController {
  private isOpen = false;

  constructor(private readonly options: SettingsDropdownControllerOptions) {}

  attach(): void {
    this.options.toggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.isOpen) {
          return;
        }
        const { dropdown, toggleButton } = this.options;
        const target = e.target as Node | null;
        if (!target) {
          return;
        }
        if (toggleButton.contains(target)) {
          return;
        }
        if (dropdown && dropdown.contains(target)) {
          return;
        }
        this.toggle(false);
      },
      true,
    );

    document.addEventListener('click', (e) => {
      const { dropdown } = this.options;
      if (this.isOpen && dropdown && !dropdown.contains(e.target as Node)) {
        this.toggle(false);
      }
    });
  }

  toggle(open?: boolean): void {
    this.isOpen = open ?? !this.isOpen;

    const { dropdown, toggleButton } = this.options;
    if (dropdown) {
      dropdown.classList.toggle('open', this.isOpen);
    }

    toggleButton.classList.toggle('active', this.isOpen);
    toggleButton.setAttribute('aria-expanded', String(this.isOpen));
  }
}
