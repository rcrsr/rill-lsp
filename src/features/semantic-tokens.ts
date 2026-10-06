import { parseWithRecovery, tokenize } from '@rcrsr/rill';
import {
  semanticTokens,
  type ServiceTokenType,
} from '@rcrsr/rill-language-service';
import {
  type SemanticTokens,
  type SemanticTokensLegend,
} from 'vscode-languageserver';

// ============================================================
// LEGEND
// ============================================================

// Array position is the wire contract: `tokenType` in the encoded data is the
// index into this list.
const LEGEND_TOKEN_TYPES = [
  'keyword',
  'operator',
  'string',
  'number',
  'comment',
  'variable',
  'function',
  'type',
  'enumMember',
] as const;

type LegendTokenType = (typeof LEGEND_TOKEN_TYPES)[number];

export const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
  tokenTypes: [...LEGEND_TOKEN_TYPES],
  tokenModifiers: [],
};

// ============================================================
// TOKEN TYPE MAP
// ============================================================

// `null` marks service token types that produce no semantic token. The mapped
// type is total over `ServiceTokenType`: a new upstream member fails
// type-checking here.
const SERVICE_TOKEN_TYPE_MAP: {
  readonly [K in ServiceTokenType]: LegendTokenType | null;
} = {
  keyword: 'keyword',
  operator: 'operator',
  string: 'string',
  number: 'number',
  comment: 'comment',
  variableName: 'variable',
  functionName: 'function',
  typeName: 'type',
  bool: 'keyword',
  meta: 'enumMember',
  punctuation: null,
  bracket: null,
};

// ============================================================
// SEMANTIC TOKENS
// ============================================================

/**
 * Lexes and parses `text`, classifies tokens via the language service, maps
 * them to `SEMANTIC_TOKENS_LEGEND`, drops punctuation and brackets, and
 * re-encodes the relative deltas against the previous emitted token. Never
 * throws: any failure returns empty data and is reported to `onError`.
 */
export function computeSemanticTokens(
  text: string,
  onError?: (error: unknown) => void
): SemanticTokens {
  try {
    const tokens = tokenize(text, undefined, { includeComments: true });
    const parsed = parseWithRecovery(text);
    return { data: encode(semanticTokens(parsed, tokens, text)) };
  } catch (error) {
    report(error, onError);
    return { data: [] };
  }
}

function encode(tokens: ReturnType<typeof semanticTokens>): number[] {
  const data: number[] = [];
  let line = 0;
  let start = 0;
  let emittedLine = 0;
  let emittedStart = 0;
  for (const token of tokens) {
    // Decode the service's relative deltas to an absolute position.
    line += token.deltaLine;
    start = token.deltaLine === 0 ? start + token.deltaStart : token.deltaStart;

    const legendType = SERVICE_TOKEN_TYPE_MAP[token.tokenType];
    if (legendType === null) continue;

    const deltaLine = line - emittedLine;
    const deltaStart = deltaLine === 0 ? start - emittedStart : start;
    data.push(
      deltaLine,
      deltaStart,
      token.length,
      LEGEND_TOKEN_TYPES.indexOf(legendType),
      token.tokenModifiers
    );
    emittedLine = line;
    emittedStart = start;
  }
  return data;
}

// A throwing callback must not escape the handler.
function report(error: unknown, onError?: (error: unknown) => void): void {
  if (onError === undefined) return;
  try {
    onError(error);
  } catch {
    // Reporting is best-effort; the empty result is already decided.
  }
}
