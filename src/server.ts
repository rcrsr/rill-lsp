import {
  TextDocumentSyncKind,
  TextDocuments,
  type Connection,
  type InitializeResult,
  type ServerCapabilities,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { computeDiagnostics } from './features/diagnostics.js';

// ============================================================
// CAPABILITIES
// ============================================================

/**
 * The capabilities this server advertises. Clients invoke only what is listed
 * here, so a feature lands in this object in the same change as its handler.
 */
export const SERVER_CAPABILITIES: ServerCapabilities = {
  textDocumentSync: TextDocumentSyncKind.Incremental,
};

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

  documents.listen(connection);
  connection.listen();
}
