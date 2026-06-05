export type DesktopVariant = 'default' | 'work';

export interface DesktopAppConfig {
  variant: DesktopVariant;
  productName: string;
  appId: string;
  defaultBackendUrl: string;
}

export interface DesktopAppConfigEnv {
  ASSISTANT_DESKTOP_VARIANT?: string | undefined;
  ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL?: string | undefined;
}

const DEFAULT_BACKEND_URL = 'https://assistant';
const WORK_BACKEND_URL = 'https://assistant/assistant-work';

export function resolveDesktopAppConfig(env: DesktopAppConfigEnv): DesktopAppConfig {
  const variant: DesktopVariant = env.ASSISTANT_DESKTOP_VARIANT === 'work' ? 'work' : 'default';
  const defaultBackendUrl =
    env.ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL?.trim() ||
    (variant === 'work' ? WORK_BACKEND_URL : DEFAULT_BACKEND_URL);

  if (variant === 'work') {
    return {
      variant,
      productName: 'Assistant Work',
      appId: 'com.assistant.desktop.work',
      defaultBackendUrl,
    };
  }

  return {
    variant,
    productName: 'Assistant',
    appId: 'com.assistant.desktop',
    defaultBackendUrl,
  };
}

declare const ASSISTANT_DESKTOP_VARIANT: string | undefined;
declare const ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL: string | undefined;

function getBuildTimeEnv(): DesktopAppConfigEnv {
  return {
    ASSISTANT_DESKTOP_VARIANT:
      typeof ASSISTANT_DESKTOP_VARIANT === 'string' ? ASSISTANT_DESKTOP_VARIANT : undefined,
    ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL:
      typeof ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL === 'string'
        ? ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL
        : undefined,
  };
}

export const appConfig = resolveDesktopAppConfig(getBuildTimeEnv());
