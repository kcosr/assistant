import type { ContextLineOptions } from './chatMessageRenderer';

export interface InputContextItem {
  type: string;
  id: string;
}

export interface ResolvedInputContext {
  enabled: boolean;
  contextLine: string;
}

export interface ResolveInputContextOptions {
  includePanelContext: boolean;
  briefModeEnabled: boolean;
  activePanel: ContextLineOptions['panel'];
  activeContextItem: InputContextItem | null;
  activeContextItemName: string | null;
  activeContextItemDescription: string | null;
  selectedItemIds: string[];
  selectedItemTitles: string[];
  contextAttributes: ContextLineOptions['contextAttributes'];
  buildContextLine: (
    contextItem: InputContextItem | null,
    contextItemName: string | null,
    selectedItemIds: string[],
    contextItemDescription: string | null,
    options?: ContextLineOptions,
    selectedItemTitles?: string[],
  ) => string;
}

export function resolveInputContext(options: ResolveInputContextOptions): ResolvedInputContext {
  const activePanel = options.includePanelContext ? (options.activePanel ?? null) : null;
  const activeContextItem = options.includePanelContext ? options.activeContextItem : null;
  const useContextItem = options.includePanelContext && !!activeContextItem;
  const contextAttributes = options.includePanelContext ? (options.contextAttributes ?? null) : null;
  const hasContextAttributes =
    options.includePanelContext &&
    !!contextAttributes &&
    Object.keys(contextAttributes).length > 0;

  const contextLine = options.buildContextLine(
    useContextItem ? activeContextItem : null,
    useContextItem ? options.activeContextItemName : null,
    useContextItem ? options.selectedItemIds : [],
    useContextItem ? options.activeContextItemDescription : null,
    {
      mode: options.briefModeEnabled ? 'brief' : null,
      panel: activePanel,
      contextAttributes,
    },
    useContextItem ? options.selectedItemTitles : [],
  );

  return {
    enabled: Boolean(activePanel) || useContextItem || hasContextAttributes,
    contextLine,
  };
}
