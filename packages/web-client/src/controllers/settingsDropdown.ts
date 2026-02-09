export interface SettingsDropdownControllerOptions {
  dropdown: HTMLElement | null;
  toggleButton: HTMLElement;
}

const DROPDOWN_VIEWPORT_PADDING_PX = 8;
const DROPDOWN_MIN_HEIGHT_PX = 120;

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

    window.addEventListener('resize', () => {
      if (!this.isOpen) {
        return;
      }
      this.updateDropdownMaxHeight();
    });
  }

  toggle(open?: boolean): void {
    this.isOpen = open ?? !this.isOpen;

    const { dropdown, toggleButton } = this.options;
    if (dropdown) {
      dropdown.classList.toggle('open', this.isOpen);
      if (this.isOpen) {
        this.updateDropdownMaxHeight();
      } else {
        dropdown.style.maxHeight = '';
      }
    }

    toggleButton.classList.toggle('active', this.isOpen);
    toggleButton.setAttribute('aria-expanded', String(this.isOpen));
  }

  isDropdownOpen(): boolean {
    return this.isOpen;
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }
    this.toggle(false);
  }

  private updateDropdownMaxHeight(): void {
    const { dropdown } = this.options;
    if (!dropdown) {
      return;
    }
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
      return;
    }
    const dropdownRect = dropdown.getBoundingClientRect();
    const availableHeight = Math.floor(viewportHeight - dropdownRect.top - DROPDOWN_VIEWPORT_PADDING_PX);
    const maxHeight = Math.max(DROPDOWN_MIN_HEIGHT_PX, availableHeight);
    dropdown.style.maxHeight = `${maxHeight}px`;
  }
}
