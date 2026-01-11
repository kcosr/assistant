import type { PanelEventEnvelope } from '@assistant/shared';
import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';

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

      const body = document.createElement('div');
      body.className = 'panel-body ws-echo-panel-body';

      const title = document.createElement('div');
      title.className = 'ws-echo-panel-title';
      title.textContent = 'WS Echo Panel';

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

      body.appendChild(title);
      body.appendChild(inputLabel);
      body.appendChild(textarea);
      body.appendChild(outputLabel);
      body.appendChild(output);
      container.appendChild(body);

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
        unmount() {
          textarea.removeEventListener('input', onInput);
          container.classList.remove('ws-echo-panel');
          container.innerHTML = '';
        },
      };
    },
  }));
}
