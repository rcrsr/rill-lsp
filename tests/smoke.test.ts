import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Transport and packaging smoke test: builds the package and drives the
// built bin over real stdio. Handler behavior is covered by the in-memory
// tests in server.test.ts and tests/features/.

// ============================================================
// CONSTANTS
// ============================================================

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'dist', 'bin.js');
const BUILD_TIMEOUT_MS = 120_000;
const EXCHANGE_TIMEOUT_MS = 20_000;
const INITIALIZE_BUDGET_MS = 1_000;
const URI = 'file:///smoke.rill';
const SOURCE = '"hello" => $greeting\n42 => $count\n';

// ============================================================
// HELPERS
// ============================================================

interface Message {
  readonly jsonrpc?: unknown;
  readonly id?: number | string;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface ParsedStream {
  readonly messages: Message[];
  readonly stray: string | undefined;
}

function frame(message: object): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

/**
 * Strictly parse a stdout buffer as a sequence of Content-Length frames.
 * Any byte outside a complete frame is reported in `stray`.
 */
function parseFrames(buffer: Buffer): ParsedStream {
  const messages: Message[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset, 'latin1');
    if (headerEnd === -1) {
      return { messages, stray: buffer.subarray(offset).toString('latin1') };
    }
    const headerLines = buffer
      .subarray(offset, headerEnd)
      .toString('ascii')
      .split('\r\n');
    const lengthLine = headerLines[0] ?? '';
    const match = /^Content-Length: (\d+)$/.exec(lengthLine);
    const rest = headerLines.slice(1);
    if (
      match === null ||
      !rest.every((line) => /^Content-Type: [^\r\n]+$/.test(line))
    ) {
      return { messages, stray: buffer.subarray(offset).toString('latin1') };
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (bodyEnd > buffer.length) {
      return { messages, stray: buffer.subarray(offset).toString('latin1') };
    }
    try {
      messages.push(
        JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8'))
      );
    } catch {
      return { messages, stray: buffer.subarray(offset).toString('latin1') };
    }
    offset = bodyEnd;
  }
  return { messages, stray: undefined };
}

interface Session {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly initializeMs: number;
  readonly semanticTokensResult: unknown;
}

function runSession(): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    const started = performance.now();
    const child: ChildProcess = spawn('node', [BIN], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    let stderr = '';
    let initializeMs = -1;
    let semanticTokensResult: unknown;
    let settled = false;
    let consumed = 0;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new Error(`${error.message}\nstderr:\n${stderr}`));
    };
    const timer = setTimeout(
      () => fail(new Error('smoke exchange timed out')),
      EXCHANGE_TIMEOUT_MS
    );
    const send = (message: object): void => {
      child.stdin?.write(frame(message));
    };

    child.on('error', fail);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      out.push(chunk);
      const { messages } = parseFrames(Buffer.concat(out));
      for (const message of messages.slice(consumed)) {
        if (message.id === 1 && message.method === undefined) {
          initializeMs = performance.now() - started;
          send({ jsonrpc: '2.0', method: 'initialized', params: {} });
          send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: URI,
                languageId: 'rill',
                version: 1,
                text: SOURCE,
              },
            },
          });
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/semanticTokens/full',
            params: { textDocument: { uri: URI } },
          });
        } else if (message.id === 2 && message.method === undefined) {
          semanticTokensResult = message.result;
          send({ jsonrpc: '2.0', id: 3, method: 'shutdown' });
        } else if (message.id === 3 && message.method === undefined) {
          send({ jsonrpc: '2.0', method: 'exit' });
        }
      }
      consumed = messages.length;
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out),
        stderr,
        exitCode,
        initializeMs,
        semanticTokensResult,
      });
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
      },
    });
  });
}

// ============================================================
// TESTS
// ============================================================

describe('rill-lsp stdio transport', () => {
  let session: Session;

  beforeAll(async () => {
    try {
      // tsc --build trusts tsconfig.tsbuildinfo, so a deleted dist/ would
      // otherwise count as up to date and emit nothing. Force in that case.
      const args = existsSync(BIN)
        ? ['run', 'build']
        : ['run', 'build', '--force'];
      execFileSync('pnpm', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: BUILD_TIMEOUT_MS - 5_000,
      });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      throw new Error(
        `build failed\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`,
        { cause: error }
      );
    }
    session = await runSession();
  }, BUILD_TIMEOUT_MS + EXCHANGE_TIMEOUT_MS);

  it('returns non-empty semantic token data for an opened document', () => {
    const result = session.semanticTokensResult as
      | { data?: unknown }
      | null
      | undefined;

    const data = result?.data;
    expect(Array.isArray(data)).toBe(true);
    expect(data).not.toHaveLength(0);
  });

  it('frames every byte written to stdout as a JSON-RPC message', () => {
    const parsed = parseFrames(session.stdout);

    expect(parsed.stray).toBeUndefined();
    expect(parsed.messages.length).toBeGreaterThan(0);
    for (const message of parsed.messages) {
      expect(message.jsonrpc).toBe('2.0');
    }
  });

  it('answers initialize within one second of spawn', () => {
    expect(session.initializeMs).toBeGreaterThanOrEqual(0);
    expect(session.initializeMs).toBeLessThan(INITIALIZE_BUDGET_MS);
  });

  it('exits with code 0 after the exit notification', () => {
    expect(session.exitCode).toBe(0);
  });
});
