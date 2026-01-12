import parser from 'cron-parser';
import cronstrue from 'cronstrue';

export function parseNextRun(cron: string): Date {
  const expression = parser.parseExpression(cron);
  return expression.next().toDate();
}

export function describeCron(cron: string): string {
  return cronstrue.toString(cron, { throwExceptionOnParseError: false });
}

export function isValidCron5Field(cron: string): boolean {
  const trimmed = cron.trim();
  if (!trimmed) {
    return false;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }
  try {
    parser.parseExpression(trimmed);
    return true;
  } catch {
    return false;
  }
}
