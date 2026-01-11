import type { PanelFactory, PanelHandle, PanelModule } from '../../controllers/panelRegistry';
export function createEmptyPanel(): PanelFactory {
  return (): PanelModule => ({
    mount(container, host): PanelHandle {
      container.innerHTML = '';

      const body = document.createElement('div');
      body.className = 'panel-body panel-empty';

      const content = document.createElement('div');
      content.className = 'panel-empty-content';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'panel-empty-button';
      button.textContent = 'Add panel';
      const canLaunch = typeof host.openPanelLauncher === 'function';
      if (!canLaunch) {
        button.disabled = true;
        button.title = 'Panel launcher unavailable';
      } else {
        button.addEventListener('click', () => {
          host.openPanelLauncher?.({ replacePanelId: host.panelId() });
        });
      }

      content.appendChild(button);
      body.appendChild(content);
      container.appendChild(body);

      return {
        onFocus() {
          if (!button.disabled) {
            button.focus();
          }
        },
        unmount() {
          container.innerHTML = '';
        },
      };
    },
  });
}
