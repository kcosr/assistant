import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface Config {
  baseUrl: string;
}

function loadConfig(): Config | null {
  const url = process.env.ASSISTANT_URL;
  if (url) {
    return { baseUrl: url.replace(/\/+$/, '') };
  }

  // Try loading from config file
  const configNames = ['assistant.config.json'];
  for (const name of configNames) {
    const configPath = path.resolve(process.cwd(), name);
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.url) {
          return { baseUrl: parsed.url.replace(/\/+$/, '') };
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return null;
}

async function httpRequest<T>(
  config: Config,
  options: {
    path: string;
    method: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const url = `${config.baseUrl}/api/plugins/artifacts${options.path}`;

  const response = await fetch(url, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

function printResult(result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const parser = yargs(hideBin(process.argv))
    .scriptName('artifacts-cli')
    .usage('Usage: $0 <command> [options]')
    .option('json', {
      type: 'boolean',
      default: true,
      describe: 'Output JSON',
    })
    .middleware([
      (argv) => {
        if (argv.help || argv.h) {
          return;
        }
        if (!config) {
          console.error(
            'Error: ASSISTANT_URL not set. Set the environment variable or create assistant.config.json.',
          );
          process.exit(1);
        }
      },
    ])
    .command(
      'instance_list',
      'List configured instances.',
      {},
      async (argv) => {
        const result = await httpRequest(config!, {
          path: '/operations/instance_list',
          method: 'POST',
          body: {},
        });
        printResult(result, argv.json as boolean);
      },
    )
    .command(
      'list',
      'List artifacts.',
      {
        instance_id: {
          type: 'string',
          describe: 'Instance id (defaults to "default").',
        },
      },
      async (argv) => {
        const result = await httpRequest(config!, {
          path: '/operations/list',
          method: 'POST',
          body: {
            ...(argv.instance_id ? { instance_id: argv.instance_id } : {}),
          },
        });
        printResult(result, argv.json as boolean);
      },
    )
    .command(
      'upload',
      'Upload a file as an artifact.',
      {
        file: {
          type: 'string',
          describe: 'Path to file to upload.',
          demandOption: true,
        },
        title: {
          type: 'string',
          describe: 'Display title for the artifact.',
          demandOption: true,
        },
        filename: {
          type: 'string',
          describe: 'Override filename (defaults to file basename).',
        },
        mimeType: {
          type: 'string',
          describe: 'MIME type of the file.',
        },
        instance_id: {
          type: 'string',
          describe: 'Instance id (defaults to "default").',
        },
      },
      async (argv) => {
        const filePath = argv.file as string;
        if (!fs.existsSync(filePath)) {
          console.error(`Error: File not found: ${filePath}`);
          process.exit(1);
        }

        const content = fs.readFileSync(filePath);
        const base64Content = content.toString('base64');
        const filename = (argv.filename as string) || path.basename(filePath);

        const result = await httpRequest(config!, {
          path: '/operations/upload',
          method: 'POST',
          body: {
            title: argv.title,
            filename,
            content: base64Content,
            ...(argv.mimeType ? { mimeType: argv.mimeType } : {}),
            ...(argv.instance_id ? { instance_id: argv.instance_id } : {}),
          },
        });
        printResult(result, argv.json as boolean);
      },
    )
    .command(
      'download',
      'Download an artifact to a local file path.',
      {
        id: {
          type: 'string',
          describe: 'Artifact id.',
          demandOption: true,
        },
        path: {
          type: 'string',
          describe: 'Local file path to write the artifact to.',
          demandOption: true,
        },
        instance_id: {
          type: 'string',
          describe: 'Instance id (defaults to "default").',
        },
      },
      async (argv) => {
        // Get artifact content from server
        const response = await httpRequest<{
          ok: boolean;
          result: {
            id: string;
            title: string;
            filename: string;
            mimeType: string;
            content: string;
          };
        }>(config!, {
          path: '/operations/get',
          method: 'POST',
          body: {
            id: argv.id,
            ...(argv.instance_id ? { instance_id: argv.instance_id } : {}),
          },
        });

        // Resolve path and write locally
        const downloadPath = path.isAbsolute(argv.path as string)
          ? (argv.path as string)
          : path.resolve(process.cwd(), argv.path as string);

        const content = Buffer.from(response.result.content, 'base64');
        
        // Ensure parent directory exists
        const dir = path.dirname(downloadPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(downloadPath, content);

        printResult({ path: downloadPath, filename: response.result.filename }, argv.json as boolean);
      },
    )
    .command(
      'update',
      "Replace an artifact's file content.",
      {
        id: {
          type: 'string',
          describe: 'Artifact id.',
          demandOption: true,
        },
        file: {
          type: 'string',
          describe: 'Path to new file.',
          demandOption: true,
        },
        filename: {
          type: 'string',
          describe: 'Override filename (defaults to file basename).',
        },
        mimeType: {
          type: 'string',
          describe: 'MIME type of the file.',
        },
        instance_id: {
          type: 'string',
          describe: 'Instance id (defaults to "default").',
        },
      },
      async (argv) => {
        const filePath = argv.file as string;
        if (!fs.existsSync(filePath)) {
          console.error(`Error: File not found: ${filePath}`);
          process.exit(1);
        }

        const content = fs.readFileSync(filePath);
        const base64Content = content.toString('base64');
        const filename = (argv.filename as string) || path.basename(filePath);

        const result = await httpRequest(config!, {
          path: '/operations/update',
          method: 'POST',
          body: {
            id: argv.id,
            filename,
            content: base64Content,
            ...(argv.mimeType ? { mimeType: argv.mimeType } : {}),
            ...(argv.instance_id ? { instance_id: argv.instance_id } : {}),
          },
        });
        printResult(result, argv.json as boolean);
      },
    )
    .command(
      'rename',
      "Rename an artifact's title.",
      {
        id: {
          type: 'string',
          describe: 'Artifact id.',
          demandOption: true,
        },
        title: {
          type: 'string',
          describe: 'New title.',
          demandOption: true,
        },
        instance_id: {
          type: 'string',
          describe: 'Instance id (defaults to "default").',
        },
      },
      async (argv) => {
        const result = await httpRequest(config!, {
          path: '/operations/rename',
          method: 'POST',
          body: {
            id: argv.id,
            title: argv.title,
            ...(argv.instance_id ? { instance_id: argv.instance_id } : {}),
          },
        });
        printResult(result, argv.json as boolean);
      },
    )
    .command(
      'delete',
      'Delete an artifact.',
      {
        id: {
          type: 'string',
          describe: 'Artifact id.',
          demandOption: true,
        },
        instance_id: {
          type: 'string',
          describe: 'Instance id (defaults to "default").',
        },
      },
      async (argv) => {
        const result = await httpRequest(config!, {
          path: '/operations/delete',
          method: 'POST',
          body: {
            id: argv.id,
            ...(argv.instance_id ? { instance_id: argv.instance_id } : {}),
          },
        });
        printResult(result, argv.json as boolean);
      },
    )
    .demandCommand(1, 'You must specify a command')
    .strict()
    .help();

  await parser.parseAsync();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
