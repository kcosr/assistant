import fs from 'node:fs/promises';
import path from 'node:path';

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage:',
      '  node scripts/verify-chat-replay-prefix.mjs <chat-completions.jsonl> [--session <id>]',
      '',
      'Checks that each subsequent request payload.input includes the entire previous',
      'request payload.input as an exact item-for-item prefix.',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let filePath = '';
  let sessionId = '';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--session') {
      sessionId = args[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (!arg.startsWith('-') && !filePath) {
      filePath = arg;
    }
  }

  return { filePath, sessionId };
}

function stringifyItem(item) {
  return JSON.stringify(item);
}

export function parseRequestRecords(jsonl, sessionId = '') {
  const lines = jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const records = [];
  for (const line of lines) {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') continue;
    if (parsed.direction !== 'request') continue;
    if (sessionId && parsed.sessionId !== sessionId) continue;
    const input = parsed.payload?.input;
    if (!Array.isArray(input)) continue;
    records.push(parsed);
  }

  return records;
}

export function verifyReplayPrefixes(records) {
  const mismatches = [];

  for (let i = 1; i < records.length; i += 1) {
    const previous = records[i - 1];
    const current = records[i];
    const previousInput = previous.payload.input;
    const currentInput = current.payload.input;

    if (currentInput.length < previousInput.length) {
      mismatches.push({
        type: 'shorter_input',
        previousIndex: i - 1,
        currentIndex: i,
        previousResponseId: previous.responseId ?? null,
        currentResponseId: current.responseId ?? null,
        previousTimestamp: previous.timestamp ?? null,
        currentTimestamp: current.timestamp ?? null,
        previousLength: previousInput.length,
        currentLength: currentInput.length,
      });
      continue;
    }

    for (let itemIndex = 0; itemIndex < previousInput.length; itemIndex += 1) {
      const previousSerialized = stringifyItem(previousInput[itemIndex]);
      const currentSerialized = stringifyItem(currentInput[itemIndex]);
      if (previousSerialized === currentSerialized) continue;

      mismatches.push({
        type: 'prefix_mismatch',
        previousIndex: i - 1,
        currentIndex: i,
        itemIndex,
        previousResponseId: previous.responseId ?? null,
        currentResponseId: current.responseId ?? null,
        previousTimestamp: previous.timestamp ?? null,
        currentTimestamp: current.timestamp ?? null,
        previousItem: previousInput[itemIndex],
        currentItem: currentInput[itemIndex],
        previousSerialized,
        currentSerialized,
      });
      break;
    }
  }

  return {
    requestCount: records.length,
    mismatches,
    ok: mismatches.length === 0,
  };
}

async function main() {
  const { filePath, sessionId } = parseArgs(process.argv);
  if (!filePath) {
    usage();
    process.exitCode = 2;
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  const jsonl = await fs.readFile(resolvedPath, 'utf8');
  const records = parseRequestRecords(jsonl, sessionId);
  const result = verifyReplayPrefixes(records);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        filePath: resolvedPath,
        sessionId: sessionId || null,
        ...result,
      },
      null,
      2,
    ),
  );

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
