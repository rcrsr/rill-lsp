import {
  TextDocumentSyncKind,
  TextDocuments,
  type Connection,
  type InitializeResult,
  type ServerCapabilities,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { computeDiagnostics } from './features/diagnostics.js';
import { computeDocumentSymbols } from './features/document-symbols.js';
import { computeFormattingEdits } from './features/formatting.js';
import {
  SEMANTIC_TOKENS_LEGEND,
  computeSemanticTokens,
} from './features/semantic-tokens.js';

// ============================================================
// CAPABILITIES
// ============================================================

/**
 * The capabilities this server advertises. Clients invoke only what is listed
 * here, so a feature lands in this object in the same change as its handler.
 */
export const SERVER_CAPABILITIES = {
  textDocumentSync: TextDocumentSyncKind.Incremental,
  semanticTokensProvider: { legend: SEMANTIC_TOKENS_LEGEND, full: true },
  documentSymbolProvider: true,
  documentFormattingProvider: true,
} satisfies ServerCapabilities;

// ============================================================
// LOGGING
// ============================================================

/**
 * Builds the error callback a feature reports upstream failures to. Lexer
 * errors are expected while the user types, so they log at the lower level.
 */
function createErrorLogger(
  connection: Connection,
  method: string
): (error: unknown) => void {
  return (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    const line = `${method} failed: ${message}`;
    if (error instanceof Error && error.name === 'LexerError') {
      connection.console.log(line);
    } else {
      connection.console.error(line);
    }
  };
}

// ============================================================
// SERVER
// ============================================================

/**
 * Wires the rill language features onto an LSP connection. The caller owns the
 * transport: `bin.ts` passes a stdio connection, tests pass an in-memory one.
 */
export function startServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize((): InitializeResult => ({
    capabilities: SERVER_CAPABILITIES,
    serverInfo: { name: 'rill-lsp' },
  }));

  documents.onDidChangeContent(({ document }) => {
    void connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: computeDiagnostics(document.getText()),
    });
  });

  // Clear diagnostics on close, or the editor keeps showing stale squiggles
  // for a file the server no longer tracks.
  documents.onDidClose(({ document }) => {
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  const onTokensError = createErrorLogger(
    connection,
    'textDocument/semanticTokens/full'
  );
  connection.languages.semanticTokens.on(({ textDocument }) => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return { data: [] };
    return computeSemanticTokens(document.getText(), onTokensError);
  });

  const onSymbolsError = createErrorLogger(
    connection,
    'textDocument/documentSymbol'
  );
  connection.onDocumentSymbol(({ textDocument }) => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return [];
    return computeDocumentSymbols(document.getText(), onSymbolsError);
  });

  const onFormattingError = createErrorLogger(
    connection,
    'textDocument/formatting'
  );
  connection.onDocumentFormatting(({ textDocument }) => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return [];
    return computeFormattingEdits(document.getText(), onFormattingError);
  });

  documents.listen(connection);
  connection.listen();
}
