import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWithRecovery, tokenize } from '@rcrsr/rill';
import { semanticTokens } from '@rcrsr/rill-language-service';
import {
  SERVER_CAPABILITIES,
  computeDiagnostics,
  computeSemanticTokens,
} from '@rcrsr/rill-lsp';

vi.mock('@rcrsr/rill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rcrsr/rill')>();
  return {
    ...actual,
    tokenize: vi.fn(actual.tokenize),
    parseWithRecovery: vi.fn(actual.parseWithRecovery),
  };
});

vi.mock('@rcrsr/rill-language-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@rcrsr/rill-language-service')>();
  return { ...actual, semanticTokens: vi.fn(actual.semanticTokens) };
});

const LEGEND_TYPES =
  SERVER_CAPABILITIES.semanticTokensProvider.legend.tokenTypes;
const TOKEN_FIELDS = 5;

interface DecodedToken {
  line: number;
  start: number;
  length: number;
  type: string | undefined;
  modifiers: number;
}

// Decodes LSP relative-encoded data into absolute positions.
function decode(data: readonly number[]): DecodedToken[] {
  const decoded: DecodedToken[] = [];
  let line = 0;
  let start = 0;
  for (let i = 0; i < data.length; i += TOKEN_FIELDS) {
    const deltaLine = data[i] ?? 0;
    const deltaStart = data[i + 1] ?? 0;
    line += deltaLine;
    start = deltaLine === 0 ? start + deltaStart : deltaStart;
    decoded.push({
      line,
      start,
      length: data[i + 2] ?? 0,
      type: LEGEND_TYPES[data[i + 3] ?? -1],
      modifiers: data[i + 4] ?? 0,
    });
  }
  return decoded;
}

type ServiceToken = ReturnType<typeof semanticTokens>[number];

function serviceToken(
  tokenType: ServiceToken['tokenType'],
  deltaLine: number,
  deltaStart: number,
  length: number
): ServiceToken {
  return { deltaLine, deltaStart, length, tokenType, tokenModifiers: 0 };
}

afterEach(() => {
  vi.mocked(tokenize).mockReset();
  vi.mocked(parseWithRecovery).mockReset();
  vi.mocked(semanticTokens).mockReset();
});

describe('computeSemanticTokens', () => {
  describe('real documents', () => {
    it('maps a real document to legend names at absolute positions', () => {
      const text = '"hi" => $a\n42 => $b\n';

      const decoded = decode(computeSemanticTokens(text).data);

      expect(decoded.map((t) => [t.line, t.start, t.length, t.type])).toEqual(
        expect.arrayContaining([
          [0, 0, 4, 'string'],
          [1, 0, 2, 'number'],
        ])
      );
      expect(decoded.every((t) => t.type !== undefined)).toBe(true);
    });

    it('emits number tokens for list [1, 2] with re-based deltas', () => {
      const { data } = computeSemanticTokens('list [1, 2]');

      const numbers = decode(data).filter((t) => t.type === 'number');
      expect(numbers.map((t) => t.start)).toEqual([6, 9]);
      expect(data[(data.length / TOKEN_FIELDS - 1) * TOKEN_FIELDS + 1]).toBe(3);
    });

    it('reproduces the absolute positions of the service non-omitted tokens', () => {
      const text =
        '// note\n"a {$x} b" => $y\nlist[1, 2] -> .len => $n\n#READY\n';
      const tokens = tokenize(text, undefined, { includeComments: true });
      vi.mocked(tokenize).mockReset();
      const raw = semanticTokens(parseWithRecovery(text), tokens, text);
      const expected: Array<[number, number, number]> = [];
      let line = 0;
      let start = 0;
      for (const token of raw) {
        line += token.deltaLine;
        start =
          token.deltaLine === 0 ? start + token.deltaStart : token.deltaStart;
        if (
          token.tokenType === 'punctuation' ||
          token.tokenType === 'bracket'
        ) {
          continue;
        }
        expected.push([line, start, token.length]);
      }

      const { data } = computeSemanticTokens(text);

      expect(data.length % TOKEN_FIELDS).toBe(0);
      expect(decode(data).map((t) => [t.line, t.start, t.length])).toEqual(
        expected
      );
      expect(expected.length).toBeGreaterThan(0);
      expect(decode(data).every((t) => t.modifiers === 0)).toBe(true);
    });

    it('returns empty data for empty text', () => {
      expect(computeSemanticTokens('')).toEqual({ data: [] });
    });

    it('returns empty data when only punctuation and brackets exist', () => {
      expect(computeSemanticTokens('[]')).toEqual({ data: [] });
    });

    it('measures a token after a leading bracket from the previous emitted token', () => {
      const { data } = computeSemanticTokens('[\n  1,\n]');

      expect(data).toEqual([1, 2, 1, 3, 0]);
    });

    it('splits a multi-line triple-quoted string into one token per line', () => {
      const text = '"""a\nb {$x}\nc"""';
      const lines = text.split('\n');

      const strings = decode(computeSemanticTokens(text).data).filter(
        (t) => t.type === 'string'
      );

      expect(new Set(strings.map((t) => t.line))).toEqual(new Set([0, 1, 2]));
      for (const t of strings) {
        expect(t.start + t.length).toBeLessThanOrEqual(
          (lines[t.line] ?? '').length
        );
      }
    });

    it('omits interpolation braces and keeps string segments apart from sub-tokens', () => {
      const text = '"a {$x} b"';

      const decoded = decode(computeSemanticTokens(text).data);

      expect(decoded.map((t) => t.type)).toContain('string');
      expect(decoded.map((t) => t.type)).toContain('variable');
      for (const t of decoded) {
        expect(text.slice(t.start, t.start + t.length)).not.toMatch(/[{}]/);
      }
      const strings = decoded.filter((t) => t.type === 'string');
      for (const other of decoded.filter((t) => t.type !== 'string')) {
        for (const s of strings) {
          const disjoint =
            other.start + other.length <= s.start ||
            s.start + s.length <= other.start;
          expect(disjoint).toBe(true);
        }
      }
    });
  });

  describe('stubbed service', () => {
    it('maps the 12 service types to 10 tokens with legend indices', () => {
      const types: ServiceToken['tokenType'][] = [
        'keyword',
        'operator',
        'string',
        'number',
        'comment',
        'variableName',
        'functionName',
        'typeName',
        'bool',
        'meta',
        'punctuation',
        'bracket',
      ];
      vi.mocked(semanticTokens).mockImplementationOnce(() =>
        types.map((type, i) => serviceToken(type, 0, i === 0 ? 0 : 2, 1))
      );

      const decoded = decode(computeSemanticTokens('x').data);

      expect(decoded.map((t) => t.type)).toEqual([
        'keyword',
        'operator',
        'string',
        'number',
        'comment',
        'variable',
        'function',
        'type',
        'keyword',
        'enumMember',
      ]);
    });

    it('passes length and modifiers through for a sentinel token', () => {
      vi.mocked(semanticTokens).mockImplementationOnce(() => [
        { ...serviceToken('number', 2, 7, 13), tokenModifiers: 4 },
      ]);

      const { data } = computeSemanticTokens('x');

      expect(data).toEqual([2, 7, 13, LEGEND_TYPES.indexOf('number'), 4]);
    });
  });

  describe('error handling', () => {
    it('returns empty data and reports once for an unterminated string', () => {
      const onError = vi.fn();

      const result = computeSemanticTokens('"abc', onError);

      expect(result).toEqual({ data: [] });
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['tokenize', () => vi.mocked(tokenize)],
      ['parseWithRecovery', () => vi.mocked(parseWithRecovery)],
      ['semanticTokens', () => vi.mocked(semanticTokens)],
    ])('returns empty data and reports when %s throws', (_name, getMock) => {
      const failure = new Error('boom');
      getMock().mockImplementationOnce(() => {
        throw failure;
      });
      const onError = vi.fn();

      const result = computeSemanticTokens('1 -> $x', onError);

      expect(result).toEqual({ data: [] });
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('returns empty data without onError when a stage throws', () => {
      vi.mocked(parseWithRecovery).mockImplementationOnce(() => {
        throw new Error('boom');
      });

      expect(computeSemanticTokens('1')).toEqual({ data: [] });
    });

    it('does not propagate an error thrown by onError', () => {
      const onError = vi.fn(() => {
        throw new Error('reporter failed');
      });

      expect(computeSemanticTokens('"abc', onError)).toEqual({ data: [] });
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe('performance', () => {
    it('encodes a 5,000-line document in under 400 ms on the first call', () => {
      const block = readFileSync(
        new URL('../fixtures/perf-block.rill', import.meta.url),
        'utf8'
      )
        .replace(/\n$/, '')
        .split('\n');
      const repeats = 5000 / block.length;
      const text = Array.from({ length: repeats }, () => block)
        .flat()
        .join('\n');
      expect(text.split('\n')).toHaveLength(5000);

      const startedAt = performance.now();
      const { data } = computeSemanticTokens(text);
      const elapsed = performance.now() - startedAt;

      expect(computeDiagnostics(text)).toEqual([]);
      const decoded = decode(data);
      // 400 ms is the failure line in the requirements; the 200 ms target flakes on
      // one cold sample, as about 1 in 4 fresh processes runs the whole call 3x slower.
      expect(elapsed).toBeLessThan(400);
      expect(decoded.length).toBeGreaterThanOrEqual(5000);
      expect(new Set(decoded.map((t) => t.type))).toEqual(
        new Set(LEGEND_TYPES)
      );
    });
  });
});
