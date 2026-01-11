import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { ToolError } from './errors';
import type { Tool, ToolContext, ToolHost } from './types';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
}

interface JsonRpcErrorObject {
  code: number | string;
  message: string;
  data?: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | null;
  error: JsonRpcErrorObject;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface McpToolHostOptions {
  command: string;
  name?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpToolsListResult {
  tools?: McpToolDefinition[];
}

interface McpTextContent {
  type: 'text';
  text: string;
}

interface McpToolCallResult {
  content?: Array<McpTextContent | { type: string; [key: string]: unknown }>;
  isError?: boolean;
}

interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
    [key: string]: unknown;
  };
  serverInfo?: {
    name: string;
    version: string;
  };
}

const MCP_PROTOCOL_VERSION = '2024-11-05';

export class McpToolHost implements ToolHost {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly serverName: string;
  private buffer: Buffer = Buffer.alloc(0);
  private expectedContentLength: number | null = null;
  private nextId = 1;
  private closed = false;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private cachedTools: Tool[] | null = null;

  constructor(options: McpToolHostOptions) {
    this.serverName = options.name ?? options.command;
    const args = options.args ?? [];
    const env = {
      ...process.env,
      ...(options.env ?? {}),
    };

    this.child = spawn(options.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.child.stdin.setDefaultEncoding('utf8');

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    this.child.stderr.on('data', (chunk: Buffer) => {
      console.error(`[MCP ${this.serverName} stderr]`, chunk.toString('utf8').trim());
    });

    this.child.on('error', (err) => {
      this.closed = true;
      this.rejectAllPending(
        new ToolError(
          'mcp_spawn_error',
          `Failed to start MCP server ${this.serverName}: ${String(err)}`,
        ),
      );
    });

    this.child.on('exit', (code, signal) => {
      this.closed = true;
      const message =
        code !== null
          ? `MCP server ${this.serverName} exited with code ${code}`
          : `MCP server ${this.serverName} exited with signal ${signal ?? 'unknown'}`;
      this.rejectAllPending(new ToolError('mcp_exit', message));
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.performInitialize();
    await this.initializePromise;
  }

  private async performInitialize(): Promise<void> {
    console.log(`[MCP ${this.serverName}] Sending initialize request`);

    const result = (await this.sendRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'assistant',
        version: '0.1.0',
      },
    })) as McpInitializeResult;

    console.log(`[MCP ${this.serverName}] Initialize response:`, result);

    // Send initialized notification (no response expected)
    this.sendNotification('notifications/initialized', {});

    this.initialized = true;

    console.log(`[MCP ${this.serverName}] Initialization complete`);
  }

  async listTools(): Promise<Tool[]> {
    if (this.closed) {
      throw new ToolError('mcp_closed', 'MCP tool host is not available');
    }

    await this.ensureInitialized();

    // Return cached tools if available
    if (this.cachedTools !== null) {
      return this.cachedTools;
    }

    const result = (await this.sendRequest('tools/list', {})) as McpToolsListResult;
    const tools = Array.isArray(result.tools) ? result.tools : [];

    this.cachedTools = tools.map<Tool>((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.inputSchema ?? {},
    }));

    return this.cachedTools;
  }

  async callTool(name: string, argsJson: string, _ctx: ToolContext): Promise<unknown> {
    if (this.closed) {
      throw new ToolError('mcp_closed', 'MCP tool host is not available');
    }

    await this.ensureInitialized();

    let args: unknown;
    try {
      const trimmed = argsJson.trim();
      args = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      throw new ToolError('invalid_arguments', 'Tool arguments were not valid JSON');
    }

    const params = {
      name,
      arguments: args,
    };

    const result = (await this.sendRequest('tools/call', params)) as McpToolCallResult;

    // Handle MCP tool call result format
    if (result.isError) {
      const errorText = this.extractTextFromContent(result.content);
      throw new ToolError('tool_error', errorText || 'Tool call failed');
    }

    // Extract text content from the result
    const text = this.extractTextFromContent(result.content);
    return text;
  }

  private extractTextFromContent(
    content?: Array<McpTextContent | { type: string; [key: string]: unknown }>,
  ): string {
    if (!content || !Array.isArray(content)) {
      return '';
    }

    const textParts: string[] = [];
    for (const item of content) {
      if (item.type === 'text' && typeof (item as McpTextContent).text === 'string') {
        textParts.push((item as McpTextContent).text);
      }
    }

    return textParts.join('\n');
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // MCP over stdio uses HTTP-style Content-Length framing:
    //   Content-Length: <bytes>\r\n
    //   \r\n
    //   <JSON body>
    const HEADER_DELIMITER = Buffer.from('\r\n\r\n');

    while (true) {
      if (this.expectedContentLength === null) {
        const headerEnd = this.buffer.indexOf(HEADER_DELIMITER);
        if (headerEnd === -1) {
          return;
        }

        const header = this.buffer.subarray(0, headerEnd).toString('utf8');
        const match = /Content-Length:\\s*(\\d+)/i.exec(header);
        if (!match) {
          // Malformed header; discard and try to resync.
          this.buffer = this.buffer.subarray(headerEnd + 4);

          console.error('Received MCP message without Content-Length header');
          continue;
        }

        this.expectedContentLength = Number.parseInt(match[1] ?? '', 10);
        this.buffer = this.buffer.subarray(headerEnd + 4);
      }

      if (this.expectedContentLength === null || this.buffer.length < this.expectedContentLength) {
        return;
      }

      const body = this.buffer.subarray(0, this.expectedContentLength).toString('utf8');
      this.buffer = this.buffer.subarray(this.expectedContentLength);
      this.expectedContentLength = null;

      let message: JsonRpcResponse;
      try {
        message = JSON.parse(body) as JsonRpcResponse;
      } catch {
        console.error('Failed to parse MCP JSON-RPC message');
        continue;
      }

      this.handleJsonRpcMessage(message);
    }
  }

  private handleJsonRpcMessage(message: JsonRpcResponse): void {
    const id = 'id' in message ? message.id : null;
    if (id === null || typeof id !== 'number') {
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    this.pending.delete(id);

    if ('error' in message && message.error) {
      const { code, message: errorMessage } = message.error;
      pending.reject(
        new ToolError(
          typeof code === 'string' ? code : String(code),
          errorMessage ?? 'MCP tool call failed',
        ),
      );
      return;
    }

    pending.resolve((message as JsonRpcSuccessResponse).result);
  }

  private sendNotification(method: string, params: unknown): void {
    if (this.closed) {
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const body = JSON.stringify(notification);
    const contentLength = Buffer.byteLength(body, 'utf8');
    const frame = `Content-Length: ${contentLength}\r\n\r\n${body}`;

    try {
      this.child.stdin.write(frame);
    } catch (err) {
      console.error('[MCP] Failed to send notification:', err);
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new ToolError('mcp_closed', 'MCP tool host is not available'));
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const body = JSON.stringify(request);
    const contentLength = Buffer.byteLength(body, 'utf8');
    const frame = `Content-Length: ${contentLength}\r\n\r\n${body}`;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      try {
        this.child.stdin.write(frame);
      } catch (err) {
        this.pending.delete(id);
        reject(new ToolError('mcp_write_error', `Failed to write to MCP server: ${String(err)}`));
      }
    });
  }

  private rejectAllPending(error: ToolError): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
