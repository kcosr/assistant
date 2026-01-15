import type { PanelEventEnvelope } from '@assistant/shared';
import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';

type WsEchoUpdatePayload = {
  type: 'ws_echo_update';
  text?: string;
};

const registry = window.ASSISTANT_PANEL_REGISTRY;
if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for ws-echo plugin.');
} else {
  registry.registerPanel('ws-echo', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.classList.add('ws-echo-panel');
      container.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'panel-header panel-chrome-row ws-echo-panel-header';
      header.setAttribute('data-role', 'chrome-row');
      header.innerHTML = `
        <div class="panel-header-main">
          <span class="panel-header-label" data-role="chrome-title">WS Echo</span>
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
      body.className = 'panel-body ws-echo-panel-body';

      const inputLabel = document.createElement('div');
      inputLabel.className = 'ws-echo-panel-label';
      inputLabel.textContent = 'Input';

      const textarea = document.createElement('textarea');
      textarea.className = 'ws-echo-panel-input';
      textarea.placeholder = 'Type here...';

      const outputLabel = document.createElement('div');
      outputLabel.className = 'ws-echo-panel-label';
      outputLabel.textContent = 'Echo';

      const output = document.createElement('div');
      output.className = 'ws-echo-panel-output empty';
      output.textContent = 'Waiting for input';

      body.appendChild(inputLabel);
      body.appendChild(textarea);
      body.appendChild(outputLabel);
      body.appendChild(output);
      container.appendChild(header);
      container.appendChild(body);

      const chromeController = new PanelChromeController({
        root: container,
        host,
        title: 'WS Echo',
      });

      const setOutput = (text: string | undefined) => {
        const value = typeof text === 'string' ? text : '';
        output.textContent = value.length > 0 ? value : 'Waiting for input';
        output.classList.toggle('empty', value.length === 0);
      };

      const onInput = () => {
        host.sendEvent({ type: 'ws_echo_input', text: textarea.value });
      };

      textarea.addEventListener('input', onInput);

      return {
        onEvent(event: PanelEventEnvelope) {
          const payload = event?.payload;
          if (!payload || typeof payload !== 'object') {
            return;
          }
          const typed = payload as WsEchoUpdatePayload;
          if (typed.type === 'ws_echo_update') {
            setOutput(typed.text);
          }
        },
        onVisibilityChange: (visible) => {
          if (visible) {
            chromeController.scheduleLayoutCheck();
          }
        },
        unmount() {
          textarea.removeEventListener('input', onInput);
          container.classList.remove('ws-echo-panel');
          chromeController.destroy();
          container.innerHTML = '';
        },
      };
    },
  }));
}
