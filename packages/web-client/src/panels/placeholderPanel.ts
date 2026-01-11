import type { PanelTypeManifest } from '@assistant/shared';

import type { PanelFactory } from '../controllers/panelRegistry';

type PlaceholderOptions = {
  message?: string;
  details?: string;
};

export function createPlaceholderPanel(
  manifest: PanelTypeManifest,
  options: PlaceholderOptions = {},
): PanelFactory {
  return () => ({
    mount(container) {
      container.innerHTML = '';
      const body = document.createElement('div');
      body.className = 'panel-body panel-placeholder';

      const headline = document.createElement('div');
      headline.className = 'panel-placeholder-title';
      headline.textContent =
        options.message ?? `Panel "${manifest.title}" is not available in this build.`;
      body.appendChild(headline);

      if (options.details) {
        const details = document.createElement('div');
        details.className = 'panel-placeholder-details';
        details.textContent = options.details;
        body.appendChild(details);
      }

      container.appendChild(body);
      return {
        unmount() {
          container.innerHTML = '';
        },
      };
    },
  });
}
