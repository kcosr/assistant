import type { PanelHandle, PanelModule, PanelFactory } from '../../controllers/panelRegistry';
import { WorkspaceNavigatorController } from '../../controllers/workspaceNavigatorController';

export function createWorkspaceNavigatorPanel(): PanelFactory {
  return (): PanelModule => ({
    mount(container, host): PanelHandle {
      const controller = new WorkspaceNavigatorController({ container, host });
      controller.attach();

      return {
        onVisibilityChange: (visible) => {
          if (visible) {
            controller.refresh();
          }
        },
        unmount() {
          controller.detach();
        },
      };
    },
  });
}
