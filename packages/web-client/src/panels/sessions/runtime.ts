import {
  AgentSidebarController,
  type AgentSidebarControllerOptions,
} from '../../controllers/agentSidebarController';

export type SessionsRuntimeOptions = AgentSidebarControllerOptions;

export interface SessionsRuntime {
  controller: AgentSidebarController;
  render: () => void;
  getVisibleSessionIds: () => string[];
  getSidebarElements: () => {
    agentSidebar: HTMLElement | null;
    agentSidebarSections: HTMLElement | null;
  };
}

export function createSessionsRuntime(options: SessionsRuntimeOptions): SessionsRuntime {
  const controller = new AgentSidebarController(options);
  return {
    controller,
    render: () => controller.render(),
    getVisibleSessionIds: () => controller.getVisibleSessionIds(),
    getSidebarElements: () => ({
      agentSidebar: options.agentSidebar,
      agentSidebarSections: options.agentSidebarSections,
    }),
  };
}
