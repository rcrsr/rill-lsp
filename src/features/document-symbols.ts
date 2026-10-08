import { parseWithRecovery } from '@rcrsr/rill';
import {
  documentSymbols,
  type DocumentSymbol as ServiceSymbol,
  type SymbolKind as ServiceSymbolKind,
} from '@rcrsr/rill-language-service';
import { SymbolKind, type DocumentSymbol } from 'vscode-languageserver';

// ============================================================
// DOCUMENT SYMBOLS
// ============================================================

// Total over the service's kind union: adding a service kind fails the build
// until it is mapped here.
const SYMBOL_KINDS: Record<ServiceSymbolKind, SymbolKind> = {
  variable: SymbolKind.Variable,
  function: SymbolKind.Function,
  field: SymbolKind.Field,
};

/**
 * Parses `text` with recovery and converts the service outline to LSP
 * `DocumentSymbol[]`, mapping kind strings to numeric `SymbolKind`. Never
 * throws: a failure returns `[]` and is reported through `onError`, whose own
 * exceptions are discarded.
 *
 * Ranges pass through exactly as the service produced them, so for a captured
 * closure the `selectionRange` can lie outside `range`.
 */
export function computeDocumentSymbols(
  text: string,
  onError?: (error: unknown) => void
): DocumentSymbol[] {
  try {
    return documentSymbols(parseWithRecovery(text)).map(toDocumentSymbol);
  } catch (error) {
    reportError(onError, error);
    return [];
  }
}

function toDocumentSymbol(symbol: ServiceSymbol): DocumentSymbol {
  return {
    name: symbol.name,
    kind: SYMBOL_KINDS[symbol.kind],
    range: symbol.range,
    selectionRange: symbol.selectionRange,
    ...(symbol.children !== undefined
      ? { children: symbol.children.map(toDocumentSymbol) }
      : {}),
  };
}

// A throwing callback must not turn a handled failure into a crash.
function reportError(
  onError: ((error: unknown) => void) | undefined,
  error: unknown
): void {
  try {
    onError?.(error);
  } catch {
    // Reporting is best effort; the empty result is already the outcome.
  }
}
