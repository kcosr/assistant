import type { SessionContext } from '@assistant/shared';
import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';

const registry = window.ASSISTANT_PANEL_REGISTRY;
if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for hello plugin.');
} else {
  registry.registerPanel('hello', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.classList.add('hello-panel');
      container.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'panel-header panel-chrome-row hello-panel-header';
      header.setAttribute('data-role', 'chrome-row');
      header.innerHTML = `
        <div class="panel-header-main">
          <span class="panel-header-label" data-role="chrome-title">Hello</span>
        </div>
        <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
        <div class="panel-chrome-frame-controls" data-role="chrome-controls">
          <button type="button" class="panel-chrome-button panel-chrome-toggle" data-action="toggle" aria-label="Panel controls" title="Panel controls">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <div class="panel-chrome-frame-buttons">
            <button type="button" class="panel-chrome-button" data-action="move" aria-label="Move panel" title="Move">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
              </svg>
            </button>
            <button type="button" class="panel-chrome-button" data-action="reorder" aria-label="Reorder panel" title="Reorder">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
              </svg>
            </button>
            <button type="button" class="panel-chrome-button" data-action="menu" aria-label="More actions" title="More actions">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <circle cx="12" cy="5" r="1.5"/>
                <circle cx="12" cy="12" r="1.5"/>
                <circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
          </div>
          <button type="button" class="panel-chrome-button panel-chrome-close" data-action="close" aria-label="Close panel" title="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `;

      const body = document.createElement('div');
      body.className = 'panel-body hello-panel-body';

      const sessionLine = document.createElement('div');
      sessionLine.className = 'hello-panel-session';

      body.appendChild(sessionLine);
      container.appendChild(header);
      container.appendChild(body);

      const chromeController = new PanelChromeController({
        root: container,
        host,
        title: 'Hello',
      });

      const updateSession = (ctx: SessionContext | null) => {
        const sessionId = ctx?.sessionId ? ctx.sessionId : 'None';
        sessionLine.textContent = `Session: ${sessionId}`;
      };

      updateSession(host.getSessionContext());
      const unsubscribe = host.subscribeSessionContext((ctx) => {
        updateSession(ctx);
      });

      return {
        onVisibilityChange: (visible) => {
          if (visible) {
            chromeController.scheduleLayoutCheck();
          }
        },
        unmount() {
          unsubscribe?.();
          container.classList.remove('hello-panel');
          chromeController.destroy();
          container.innerHTML = '';
        },
      };
    },
  }));
}
