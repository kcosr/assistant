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
