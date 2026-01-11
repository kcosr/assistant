import type { ToolOutputStatus } from './toolOutputRenderer';

export function extractTruncationStatusFromResult(result: unknown): ToolOutputStatus | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const anyResult = result as {
    truncation?: unknown;
    details?: { truncation?: unknown } | unknown;
    hasMore?: unknown;
    totalLines?: unknown;
    content?: unknown;
  };

  let truncation: Record<string, unknown> | null = null;

  if (anyResult.truncation && typeof anyResult.truncation === 'object') {
    truncation = anyResult.truncation as Record<string, unknown>;
  } else if (anyResult.details && typeof anyResult.details === 'object') {
    const details = anyResult.details as { truncation?: unknown };
    if (details.truncation && typeof details.truncation === 'object') {
      truncation = details.truncation as Record<string, unknown>;
    }
  }

  // Fallback for legacy read results that only expose hasMore/totalLines/content.
  if (!truncation && anyResult.hasMore === true) {
    const totalLinesValue = anyResult.totalLines;
    const contentValue = anyResult.content;

    const totalLines =
      typeof totalLinesValue === 'number' && Number.isFinite(totalLinesValue)
        ? totalLinesValue
        : undefined;

    let outputLines: number | undefined;
    if (typeof contentValue === 'string' && contentValue.length > 0) {
      outputLines = contentValue.split('\n').length;
    }

    if (totalLines !== undefined || outputLines !== undefined) {
      const summary: ToolOutputStatus = {
        truncated: true,
        truncatedBy: 'lines',
      };
      if (totalLines !== undefined) {
        summary.totalLines = totalLines;
      }
      if (outputLines !== undefined) {
        summary.outputLines = outputLines;
      }
      return summary;
    }
  }

  if (!truncation) {
    return null;
  }

  const truncatedFlag = truncation['truncated'];
  const truncatedByRaw = truncation['truncatedBy'];
  const totalLinesRaw = truncation['totalLines'];
  const totalBytesRaw = truncation['totalBytes'];
  const outputLinesRaw = truncation['outputLines'];
  const outputBytesRaw = truncation['outputBytes'];

  const truncated = truncatedFlag === true;
  const truncatedBy =
    truncatedByRaw === 'lines' || truncatedByRaw === 'bytes'
      ? (truncatedByRaw as 'lines' | 'bytes')
      : undefined;

  if (!truncated && !truncatedBy) {
    return null;
  }

  const status: ToolOutputStatus = {
    truncated: true,
  };

  if (truncatedBy) {
    status.truncatedBy = truncatedBy;
  }

  if (typeof totalLinesRaw === 'number' && Number.isFinite(totalLinesRaw)) {
    status.totalLines = totalLinesRaw;
  }
  if (typeof totalBytesRaw === 'number' && Number.isFinite(totalBytesRaw)) {
    status.totalBytes = totalBytesRaw;
  }
  if (typeof outputLinesRaw === 'number' && Number.isFinite(outputLinesRaw)) {
    status.outputLines = outputLinesRaw;
  }
  if (typeof outputBytesRaw === 'number' && Number.isFinite(outputBytesRaw)) {
    status.outputBytes = outputBytesRaw;
  }

  return status;
}
