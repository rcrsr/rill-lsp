import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as languageService from '@rcrsr/rill-language-service';
import {
  createConnection,
  createProtocolConnection,
  MessageType,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
  type Connection,
  type ProtocolConnection,
} from 'vscode-languageserver/node';
import { SERVER_CAPABILITIES, startServer } from '@rcrsr/rill-lsp';

vi.mock('@rcrsr/rill-language-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@rcrsr/rill-language-service')>();
  return {
    ...actual,
    documentSymbols: vi.fn(actual.documentSymbols),
    formatDocument: vi.fn(actual.formatDocument),
  };
});

// ============================================================
// HELPERS
// ============================================================

const METHOD_NOT_FOUND = -32601;
const URI = 'file:///test.rill';
const TAB_INDENTED = '[\n\t"a",\n\t"b"\n] => $list\n';

interface LogEntry {
  readonly type: number;
  readonly message: string;
}

interface Harness {
  readonly client: ProtocolConnection;
  readonly logs: LogEntry[];
  readonly registrations: string[];
}

const open: Harness[] = [];

/**
 * Wraps a connection so every `on*` registration startServer makes is
 * recorded by dotted path, including nested ones such as
 * `languages.semanticTokens.on`.
 */
function recordRegistrations(
  target: object,
  path: string[],
  sink: string[]
): object {
  return new Proxy(target, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop, obj);
      if (typeof prop !== 'string') return value;
      if (typeof value === 'function') {
        const bound = (value as (...args: unknown[]) => unknown).bind(obj);
        if (!prop.startsWith('on')) return bound;
        return (...args: unknown[]): unknown => {
          sink.push([...path, prop].join('.'));
          return bound(...args);
        };
      }
      if (typeof value === 'object' && value !== null) {
        return recordRegistrations(value, [...path, prop], sink);
      }
      return value;
    },
  });
}

async function startHarness(): Promise<Harness> {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const serverConnection = createConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient)
  );
  const registrations: string[] = [];
  startServer(
    recordRegistrations(serverConnection, [], registrations) as Connection
  );

  const client = createProtocolConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer)
  );
  const logs: LogEntry[] = [];
  client.onNotification('window/logMessage', (params: LogEntry) => {
    logs.push({ type: params.type, message: params.message });
  });
  client.listen();

  const harness: Harness = { client, logs, registrations };
  open.push(harness);
  await client.sendRequest('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
  });
  await client.sendNotification('initialized', {});
  return harness;
}

async function openDocument(
  harness: Harness,
  text: string,
  uri = URI
): Promise<void> {
  await harness.client.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'rill', version: 1, text },
  });
}

function requestTokens(harness: Harness, uri = URI): Promise<unknown> {
  return harness.client.sendRequest('textDocument/semanticTokens/full', {
    textDocument: { uri },
  });
}

function requestSymbols(harness: Harness, uri = URI): Promise<unknown> {
  return harness.client.sendRequest('textDocument/documentSymbol', {
    textDocument: { uri },
  });
}

function requestFormatting(
  harness: Harness,
  options: { tabSize: number; insertSpaces: boolean } = {
    tabSize: 2,
    insertSpaces: true,
  },
  uri = URI
): Promise<unknown> {
  return harness.client.sendRequest('textDocument/formatting', {
    textDocument: { uri },
    options,
  });
}

afterEach(() => {
  for (const harness of open.splice(0)) harness.client.dispose();
  vi.mocked(languageService.documentSymbols).mockClear();
  vi.mocked(languageService.formatDocument).mockClear();
});

// ============================================================
// CAPABILITIES
// ============================================================

describe('SERVER_CAPABILITIES', () => {
  it('advertises incremental document sync', () => {
    expect(SERVER_CAPABILITIES.textDocumentSync).toBe(
      TextDocumentSyncKind.Incremental
    );
  });

  it('advertises full semantic tokens without range or delta', () => {
    const provider = SERVER_CAPABILITIES.semanticTokensProvider;

    expect(provider.full).toBe(true);
    expect(provider).not.toHaveProperty('range');
  });

  it('advertises the semantic token legend in wire order', () => {
    const { legend } = SERVER_CAPABILITIES.semanticTokensProvider;

    expect(legend.tokenTypes).toEqual([
      'keyword',
      'operator',
      'string',
      'number',
      'comment',
      'variable',
      'function',
      'type',
      'enumMember',
    ]);
    expect(legend.tokenModifiers).toEqual([]);
  });

  it('advertises document symbols and formatting', () => {
    expect(SERVER_CAPABILITIES.documentSymbolProvider).toBe(true);
    expect(SERVER_CAPABILITIES.documentFormattingProvider).toBe(true);
  });
});

describe('initialize', () => {
  it('returns exactly the advertised capability keys and legend', async () => {
    const harness = await startHarness();

    const result = (await harness.client.sendRequest('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
    })) as { capabilities: Record<string, unknown> };

    expect(Object.keys(result.capabilities).sort()).toEqual(
      [
        'textDocumentSync',
        'semanticTokensProvider',
        'documentSymbolProvider',
        'documentFormattingProvider',
      ].sort()
    );
    expect(result.capabilities['semanticTokensProvider']).toEqual({
      legend: SERVER_CAPABILITIES.semanticTokensProvider.legend,
      full: true,
    });
  });
});

// ============================================================
// HANDLER REGISTRATION
// ============================================================

describe('startServer handler registration', () => {
  const CAPABILITY_METHODS: Record<string, string> = {
    semanticTokensProvider: 'textDocument/semanticTokens/full',
    documentSymbolProvider: 'textDocument/documentSymbol',
    documentFormattingProvider: 'textDocument/formatting',
  };
  const REGISTRATION_METHODS: Record<string, string> = {
    'languages.semanticTokens.on': 'textDocument/semanticTokens/full',
    onDocumentSymbol: 'textDocument/documentSymbol',
    onDocumentFormatting: 'textDocument/formatting',
  };
  const IGNORED_REGISTRATIONS = new Set([
    'onInitialize',
    'onDidOpenTextDocument',
    'onDidChangeTextDocument',
    'onDidCloseTextDocument',
    'onWillSaveTextDocument',
    'onWillSaveTextDocumentWaitUntil',
    'onDidSaveTextDocument',
  ]);

  it('registers a handler for every advertised capability and no others', async () => {
    const harness = await startHarness();

    const advertised = Object.keys(SERVER_CAPABILITIES)
      .filter((key) => key !== 'textDocumentSync')
      .map((key) => CAPABILITY_METHODS[key] ?? `unmapped capability ${key}`);
    const registered = harness.registrations
      .filter((name) => !IGNORED_REGISTRATIONS.has(name))
      .map((name) => REGISTRATION_METHODS[name] ?? `unmapped handler ${name}`);

    expect([...registered].sort()).toEqual([...advertised].sort());
  });

  it.each([
    'textDocument/hover',
    'textDocument/completion',
    'textDocument/definition',
    'textDocument/semanticTokens/full/delta',
    'textDocument/semanticTokens/range',
    'textDocument/rangeFormatting',
  ])('rejects unadvertised method %s as not found', async (method) => {
    const harness = await startHarness();
    await openDocument(harness, '1');

    await expect(
      harness.client.sendRequest(method, { textDocument: { uri: URI } })
    ).rejects.toMatchObject({ code: METHOD_NOT_FOUND });
  });

  it('answers each advertised request on an opened document', async () => {
    const harness = await startHarness();
    await openDocument(harness, '"hello" => $greeting\n');

    await expect(requestTokens(harness)).resolves.toBeDefined();
    await expect(requestSymbols(harness)).resolves.toBeDefined();
    await expect(requestFormatting(harness)).resolves.toBeDefined();
  });
});

// ============================================================
// SEMANTIC TOKENS
// ============================================================

describe('textDocument/semanticTokens/full', () => {
  it('returns encoded token data for an opened document', async () => {
    const harness = await startHarness();
    await openDocument(harness, '"hello" => $greeting\n');

    const result = (await requestTokens(harness)) as { data: number[] };

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.length % 5).toBe(0);
  });

  it('returns empty data for an unopened document without logging', async () => {
    const harness = await startHarness();

    const result = await requestTokens(harness, 'file:///never-opened.rill');

    expect(result).toEqual({ data: [] });
    expect(harness.logs).toEqual([]);
  });

  it('logs lexer errors at log level, returns empty data, and keeps serving', async () => {
    const harness = await startHarness();
    await openDocument(harness, '"abc');

    const before = harness.logs.length;

    const result = await requestTokens(harness);

    expect(result).toEqual({ data: [] });
    const added = harness.logs.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]?.type).toBe(MessageType.Log);
    expect(
      added[0]?.message.startsWith('textDocument/semanticTokens/full failed: ')
    ).toBe(true);
    expect(added[0]?.message).not.toContain('\n');
    await expect(requestSymbols(harness)).resolves.toBeDefined();
    expect(harness.logs.slice(before)).toEqual(added);
  });

  it('serves a following request after a lexer error', async () => {
    const harness = await startHarness();
    await openDocument(harness, '"abc');
    await requestTokens(harness);

    await expect(requestSymbols(harness)).resolves.toBeDefined();
  });
});

// ============================================================
// DOCUMENT SYMBOLS
// ============================================================

describe('textDocument/documentSymbol', () => {
  it('returns symbols for an opened document', async () => {
    const harness = await startHarness();
    await openDocument(harness, '"hello" => $greeting\n');

    const result = (await requestSymbols(harness)) as { name: string }[];

    expect(result.map((symbol) => symbol.name)).toContain('greeting');
  });

  it('returns an empty list for an unopened document without calling the service or logging', async () => {
    const harness = await startHarness();

    const result = await requestSymbols(harness, 'file:///never-opened.rill');

    expect(result).toEqual([]);
    expect(languageService.documentSymbols).not.toHaveBeenCalled();
    expect(harness.logs).toEqual([]);
  });

  it('logs a service failure at error level, returns [], and keeps serving', async () => {
    vi.mocked(languageService.documentSymbols).mockImplementationOnce(() => {
      throw new Error('symbols boom');
    });
    const harness = await startHarness();
    await openDocument(harness, '"hello" => $greeting\n');

    const before = harness.logs.length;

    const result = await requestSymbols(harness);

    expect(result).toEqual([]);
    const expected = [
      {
        type: MessageType.Error,
        message: 'textDocument/documentSymbol failed: symbols boom',
      },
    ];
    expect(harness.logs.slice(before)).toEqual(expected);
    await expect(requestTokens(harness)).resolves.toBeDefined();
    expect(harness.logs.slice(before)).toEqual(expected);
  });
});

// ============================================================
// FORMATTING
// ============================================================

describe('textDocument/formatting', () => {
  it('returns edits for an opened document', async () => {
    const harness = await startHarness();
    await openDocument(harness, '"hello"   =>   $greeting\n');

    const result = await requestFormatting(harness);

    expect(Array.isArray(result)).toBe(true);
  });

  it('ignores client formatting options', async () => {
    const harness = await startHarness();
    await openDocument(harness, TAB_INDENTED);

    const spaces = await requestFormatting(harness, {
      tabSize: 2,
      insertSpaces: true,
    });
    const tabs = await requestFormatting(harness, {
      tabSize: 8,
      insertSpaces: false,
    });

    expect(tabs).toEqual(spaces);
  });

  it('preserves tab indentation in the formatted output', async () => {
    const harness = await startHarness();
    await openDocument(harness, TAB_INDENTED);

    const edits = (await requestFormatting(harness)) as { newText: string }[];

    const formatted = edits.map((edit) => edit.newText).join('');
    expect(formatted).toContain('\t');
  });

  it('returns an empty list for an unopened document without calling the service or logging', async () => {
    const harness = await startHarness();

    const result = await requestFormatting(
      harness,
      { tabSize: 2, insertSpaces: true },
      'file:///never-opened.rill'
    );

    expect(result).toEqual([]);
    expect(languageService.formatDocument).not.toHaveBeenCalled();
    expect(harness.logs).toEqual([]);
  });

  it('logs a service failure at error level, returns [], and keeps serving', async () => {
    vi.mocked(languageService.formatDocument).mockImplementationOnce(() => {
      throw new Error('format boom');
    });
    const harness = await startHarness();
    await openDocument(harness, '"hello" => $greeting\n');

    const before = harness.logs.length;

    const result = await requestFormatting(harness);

    expect(result).toEqual([]);
    const expected = [
      {
        type: MessageType.Error,
        message: 'textDocument/formatting failed: format boom',
      },
    ];
    expect(harness.logs.slice(before)).toEqual(expected);
    await expect(requestSymbols(harness)).resolves.toBeDefined();
    expect(harness.logs.slice(before)).toEqual(expected);
  });
});
