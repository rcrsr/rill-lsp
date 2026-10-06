import { parseWithRecovery } from '@rcrsr/rill';
import { formatDocument } from '@rcrsr/rill-language-service';
import type { TextEdit } from 'vscode-languageserver';

// ============================================================
// FORMATTING
// ============================================================

/**
 * Parses `text` with error recovery and returns the language service's
 * whole-document edit unchanged, including when `newText` equals `text`.
 * Takes no formatting options, so client settings cannot influence output.
 *
 * Never throws. When parsing or formatting fails, returns `[]` and reports the
 * failure through `onError` if provided.
 */
export function computeFormattingEdits(
  text: string,
  onError?: (error: unknown) => void
): TextEdit[] {
  try {
    return formatDocument(parseWithRecovery(text), text);
  } catch (error) {
    reportError(error, onError);
    return [];
  }
}

// A throwing reporter must not turn a handled failure into a crash, so its
// own exception is dropped here: the caller already gets the empty result.
function reportError(
  error: unknown,
  onError: ((error: unknown) => void) | undefined
): void {
  try {
    onError?.(error);
  } catch {
    // Intentionally ignored; see above.
  }
}
