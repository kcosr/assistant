export type OperationResponse<T> = {
  ok?: boolean;
  result?: T;
};

export function sessionsOperationPath(operation: string): string {
  return `/api/plugins/sessions/operations/${operation}`;
}

export async function readSessionOperationResult<T>(response: Response): Promise<T | null> {
  const data = (await response.json()) as unknown;
  if (data && typeof data === 'object' && 'result' in data) {
    const result = (data as OperationResponse<T>).result;
    return result ?? null;
  }
  return data as T;
}

export async function readSessionOperationError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = (await response.clone().json()) as unknown;
    if (data && typeof data === 'object' && 'error' in data) {
      const error = (data as { error?: unknown }).error;
      if (typeof error === 'string' && error.trim()) {
        return error.trim();
      }
    }
  } catch {
    // Fall through to text response handling.
  }

  try {
    const text = (await response.text()).trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}
