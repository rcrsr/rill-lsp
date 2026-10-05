import { parseWithRecovery, type ParseError } from '@rcrsr/rill';
import { spanToRange } from '@rcrsr/rill-language-service';
import {
  DiagnosticSeverity,
  type Diagnostic,
  type Range,
} from 'vscode-languageserver';

// ============================================================
// DIAGNOSTICS
// ============================================================

/**
 * Parses `text` with error recovery and maps every collected parse error to
 * an LSP diagnostic. Never throws: `parseWithRecovery` collects errors rather
 * than raising them.
 */
export function computeDiagnostics(text: string): Diagnostic[] {
  return parseWithRecovery(text).errors.map(toDiagnostic);
}

function toDiagnostic(error: ParseError): Diagnostic {
  return {
    range: toRange(error),
    severity: DiagnosticSeverity.Error,
    source: 'rill',
    code: error.errorId,
    message: error.rawMessage,
    ...(error.helpUrl !== undefined
      ? { codeDescription: { href: error.helpUrl } }
      : {}),
  };
}

// A span covers the offending token. Without one, the location marks a single
// point, which LSP expresses as an empty range.
function toRange(error: ParseError): Range {
  if (error.span !== undefined) {
    return spanToRange(error.span);
  }
  const line = (error.location?.line ?? 1) - 1;
  const character = (error.location?.column ?? 1) - 1;
  return { start: { line, character }, end: { line, character } };
}
