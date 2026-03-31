import { isCapacitorAndroid } from './capacitor';

export interface AssistantLaunchBackendEntry {
  id: string;
  label: string;
  url: string;
}

export interface AssistantLaunchBackendPayload {
  selectedBackend?: AssistantLaunchBackendEntry | null;
}

export interface AssistantLaunchConfigBridgeTarget {
  resolveLaunchBackend?:
    () => AssistantLaunchBackendPayload | Promise<AssistantLaunchBackendPayload>;
}

interface AssistantLaunchConfigBridgeHost {
  AssistantLaunchConfig?: AssistantLaunchConfigBridgeTarget;
  Capacitor?: {
    Plugins?: {
      AssistantLaunchConfig?: AssistantLaunchConfigBridgeTarget;
    };
  };
}

function normalizeSelectedBackend(value: unknown): AssistantLaunchBackendEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawUrl = typeof record['url'] === 'string' ? record['url'].trim() : '';
  if (!rawUrl) {
    return null;
  }
  const rawId = typeof record['id'] === 'string' ? record['id'].trim() : '';
  const rawLabel = typeof record['label'] === 'string' ? record['label'].trim() : '';
  return {
    id: rawId || rawUrl,
    label: rawLabel || rawUrl,
    url: rawUrl,
  };
}

export class AssistantLaunchConfigBridge {
  constructor(
    private readonly getHost: () => AssistantLaunchConfigBridgeHost | null = () => {
      if (typeof window === 'undefined') {
        return null;
      }
      return window as unknown as AssistantLaunchConfigBridgeHost;
    },
  ) {}

  isAvailable(): boolean {
    return this.getTarget() !== null;
  }

  async resolveLaunchBackend(): Promise<AssistantLaunchBackendEntry | null> {
    const target = this.getTarget();
    if (!target || typeof target.resolveLaunchBackend !== 'function') {
      return null;
    }

    const payload = await Promise.resolve(target.resolveLaunchBackend());
    return normalizeSelectedBackend(payload?.selectedBackend);
  }

  private getTarget(): AssistantLaunchConfigBridgeTarget | null {
    const host = this.getHost();
    if (!host) {
      return null;
    }
    return host.AssistantLaunchConfig ?? host.Capacitor?.Plugins?.AssistantLaunchConfig ?? null;
  }
}

export async function configureNativeLaunchBackend(options?: {
  isAndroid?: () => boolean;
  bridge?: AssistantLaunchConfigBridge;
  getWindow?: () => (Window & { ASSISTANT_API_HOST?: string }) | null;
}): Promise<boolean> {
  const isAndroid = options?.isAndroid ?? isCapacitorAndroid;
  if (!isAndroid()) {
    return true;
  }

  const bridge = options?.bridge ?? new AssistantLaunchConfigBridge();
  if (!bridge.isAvailable()) {
    return true;
  }

  try {
    const selectedBackend = await bridge.resolveLaunchBackend();
    if (!selectedBackend) {
      return false;
    }
    const hostWindow =
      options?.getWindow?.() ??
      (typeof window !== 'undefined'
        ? (window as Window & { ASSISTANT_API_HOST?: string })
        : null);
    if (!hostWindow) {
      return false;
    }
    hostWindow.ASSISTANT_API_HOST = selectedBackend.url;
    return true;
  } catch (error) {
    console.error('[client] Failed to resolve Android launch backend', error);
    return false;
  }
}
