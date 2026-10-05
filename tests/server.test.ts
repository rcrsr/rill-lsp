import { describe, expect, it } from 'vitest';
import { TextDocumentSyncKind } from 'vscode-languageserver';
import { SERVER_CAPABILITIES } from '@rcrsr/rill-lsp';

describe('SERVER_CAPABILITIES', () => {
  it('advertises incremental document sync', () => {
    expect(SERVER_CAPABILITIES.textDocumentSync).toBe(
      TextDocumentSyncKind.Incremental
    );
  });
});
