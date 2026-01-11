import type {
  PanelBinding,
  PanelEventEnvelope,
  PanelInstance,
  PanelMetadata,
  PanelPlacement,
  PanelTypeManifest,
  SessionAttributesPatch,
  SessionContext,
} from '@assistant/shared';

export interface PanelInitOptions {
  binding?: PanelBinding;
  state?: unknown;
  focus?: boolean;
}

export interface PanelOpenOptions extends PanelInitOptions {
  placement?: PanelPlacement;
  targetPanelId?: string;
}

export interface PanelHandle {
  onFocus?(): void;
  onBlur?(): void;
  onResize?(size: { width: number; height: number }): void;
  onVisibilityChange?(visible: boolean): void;
  onSessionChange?(sessionId: string | null): void;
  onEvent?(event: PanelEventEnvelope): void;
  unmount(): void;
}

export interface PanelHost {
  panelId(): string;
  getBinding(): PanelBinding | null;
  setBinding(binding: PanelBinding | null): void;
  onBindingChange(handler: (binding: PanelBinding | null) => void): () => void;
  setContext(key: string, value: unknown): void;
  getContext(key: string): unknown | null;
  subscribeContext(key: string, handler: (value: unknown) => void): () => void;
  sendEvent(payload: unknown, options?: { sessionId?: string | null }): void;
  getSessionContext(): SessionContext | null;
  subscribeSessionContext(handler: (ctx: SessionContext | null) => void): () => void;
  updateSessionAttributes(patch: SessionAttributesPatch): Promise<void>;
  setPanelMetadata(meta: Partial<PanelMetadata>): void;
  persistPanelState(state: unknown): void;
  loadPanelState(): unknown | null;
  openPanel(panelType: string, options?: PanelOpenOptions): string | null;
  closePanel(panelId: string): void;
  activatePanel(panelId: string): void;
  movePanel(panelId: string, placement: PanelPlacement, targetPanelId?: string): void;
  openPanelLauncher?(options?: {
    targetPanelId?: string | null;
    defaultPlacement?: PanelPlacement | null;
    pinToHeader?: boolean;
    replacePanelId?: string | null;
  }): void;
  toggleSplitViewMode?(splitId: string): void;
  closeSplit?(splitId: string): void;
}

export interface PanelModule {
  mount(container: HTMLElement, host: PanelHost, init: PanelInitOptions): PanelHandle;
}

export type PanelFactory = () => PanelModule;

interface PanelRegistration {
  manifest: PanelTypeManifest;
  factory: PanelFactory;
}

export class PanelRegistry {
  private readonly registry = new Map<string, PanelRegistration>();

  register(manifest: PanelTypeManifest, factory: PanelFactory): void {
    if (this.registry.has(manifest.type)) {
      throw new Error(`Panel type already registered: ${manifest.type}`);
    }

    this.registry.set(manifest.type, { manifest, factory });
  }

  registerOrReplace(manifest: PanelTypeManifest, factory: PanelFactory): void {
    this.registry.set(manifest.type, { manifest, factory });
  }

  has(panelType: string): boolean {
    return this.registry.has(panelType);
  }

  updateManifest(panelType: string, manifest: PanelTypeManifest): void {
    const entry = this.registry.get(panelType);
    if (!entry) {
      throw new Error(`Panel type not registered: ${panelType}`);
    }
    if (manifest.type !== panelType) {
      throw new Error(`Panel manifest type mismatch: ${manifest.type} vs ${panelType}`);
    }
    entry.manifest = manifest;
  }

  getManifest(panelType: string): PanelTypeManifest | null {
    return this.registry.get(panelType)?.manifest ?? null;
  }

  listManifests(): PanelTypeManifest[] {
    return Array.from(this.registry.values()).map((entry) => entry.manifest);
  }

  createInstance(
    panelType: string,
    panelId: string,
    options: PanelInitOptions = {},
  ): PanelInstance {
    const registration = this.registry.get(panelType);
    if (!registration) {
      throw new Error(`Unknown panel type: ${panelType}`);
    }

    const instance: PanelInstance = { panelId, panelType };
    if (options.binding) {
      instance.binding = options.binding;
    }
    if (options.state !== undefined) {
      instance.state = options.state;
    }
    return instance;
  }

  createModule(panelType: string): PanelModule {
    const registration = this.registry.get(panelType);
    if (!registration) {
      throw new Error(`Unknown panel type: ${panelType}`);
    }

    return registration.factory();
  }
}
