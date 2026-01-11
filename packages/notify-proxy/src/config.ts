export interface NotifyProxyConfig {
  port: number;
  serviceAccountPath: string;
  deviceToken: string;
  notifySecret?: string;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NotifyProxyConfig {
  const serviceAccountPath = env['FCM_SERVICE_ACCOUNT_PATH'];
  if (!serviceAccountPath) {
    throw new Error('FCM_SERVICE_ACCOUNT_PATH is required');
  }

  const deviceToken = env['FCM_DEVICE_TOKEN'];
  if (!deviceToken) {
    throw new Error('FCM_DEVICE_TOKEN is required');
  }

  const portValue = env['PORT'];
  const notifySecret = env['NOTIFY_SECRET'];

  let port = 3001;
  if (portValue !== undefined) {
    const parsed = Number(portValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('PORT must be a positive number when set');
    } else {
      port = parsed;
    }
  }

  return {
    port,
    serviceAccountPath,
    deviceToken,
    ...(notifySecret ? { notifySecret } : {}),
  };
}
