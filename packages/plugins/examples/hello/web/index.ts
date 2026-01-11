import type { SessionContext } from '@assistant/shared';

type PanelHost = {
  getSessionContext(): SessionContext | null;
  subscribeSessionContext(handler: (ctx: SessionContext | null) => void): () => void;
};

const registry = window.ASSISTANT_PANEL_REGISTRY;
if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for hello plugin.');
} else {
  registry.registerPanel('hello', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.classList.add('hello-panel');
      container.innerHTML = '';

      const body = document.createElement('div');
      body.className = 'panel-body hello-panel-body';

      const title = document.createElement('div');
      title.className = 'hello-panel-title';
      title.textContent = 'Hello Panel';

      const sessionLine = document.createElement('div');
      sessionLine.className = 'hello-panel-session';

      body.appendChild(title);
      body.appendChild(sessionLine);
      container.appendChild(body);

      const updateSession = (ctx: SessionContext | null) => {
        const sessionId = ctx?.sessionId ? ctx.sessionId : 'None';
        sessionLine.textContent = `Session: ${sessionId}`;
      };

      updateSession(host.getSessionContext());
      const unsubscribe = host.subscribeSessionContext((ctx) => {
        updateSession(ctx);
      });

      return {
        unmount() {
          unsubscribe?.();
          container.classList.remove('hello-panel');
          container.innerHTML = '';
        },
      };
    },
  }));
}
