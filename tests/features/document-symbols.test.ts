import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SymbolKind, type DocumentSymbol } from 'vscode-languageserver';
import { parseWithRecovery } from '@rcrsr/rill';
import { documentSymbols } from '@rcrsr/rill-language-service';
import { computeDiagnostics, computeDocumentSymbols } from '@rcrsr/rill-lsp';

vi.mock('@rcrsr/rill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rcrsr/rill')>();
  return { ...actual, parseWithRecovery: vi.fn(actual.parseWithRecovery) };
});

vi.mock('@rcrsr/rill-language-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@rcrsr/rill-language-service')>();
  return { ...actual, documentSymbols: vi.fn(actual.documentSymbols) };
});

const FIXTURE_DIR = new URL('../fixtures/', import.meta.url);

function readFixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_DIR), 'utf8');
}

function range(
  line: number,
  start: number,
  end: number
): DocumentSymbol['range'] {
  return {
    start: { line, character: start },
    end: { line, character: end },
  };
}

function findSymbol(
  symbols: DocumentSymbol[],
  name: string
): DocumentSymbol | undefined {
  return symbols.find((symbol) => symbol.name === name);
}

afterEach(() => {
  vi.mocked(parseWithRecovery).mockClear();
  vi.mocked(documentSymbols).mockClear();
});

describe('computeDocumentSymbols', () => {
  describe('real input', () => {
    it('nests a captured variable under its closure with variable and function kinds', () => {
      const symbols = computeDocumentSymbols('|x| ($x + 1 => $next) => $inc\n');

      const inc = findSymbol(symbols, 'inc');
      expect(inc?.kind).toBe(SymbolKind.Function);
      const next = findSymbol(inc?.children ?? [], 'next');
      expect(next?.kind).toBe(SymbolKind.Variable);
    });

    it('nests field symbols for a dict entry whose value is a dict', () => {
      const symbols = computeDocumentSymbols(
        'dict[a: 1, b: dict[c: 2, d: "x"]] => $cfg\n'
      );

      const b = findSymbol(symbols, 'b');
      expect(b?.kind).toBe(SymbolKind.Field);
      const c = findSymbol(b?.children ?? [], 'c');
      expect(c?.kind).toBe(SymbolKind.Field);
    });

    it('returns symbols recovered before a parse error in document order', () => {
      const text = readFixture('symbols-recovery.rill');

      const symbols = computeDocumentSymbols(text);

      expect(symbols.map((s) => s.kind)).toEqual([
        SymbolKind.Variable,
        SymbolKind.Function,
      ]);
      expect(symbols[0]?.range.start.line).toBe(0);
      expect(symbols[1]?.range.start.line).toBe(1);
    });

    it('reports a diagnostic on the broken line of the recovery fixture', () => {
      const text = readFixture('symbols-recovery.rill');

      const diagnostics = computeDiagnostics(text);

      expect(diagnostics.some((d) => d.range.start.line === 2)).toBe(true);
    });

    it('returns a well-formed result without throwing for lexer-invalid input', () => {
      const onError = vi.fn();

      const symbols = computeDocumentSymbols(
        '"unterminated\n@@@ ` ~~ \\',
        onError
      );

      expect(Array.isArray(symbols)).toBe(true);
      for (const symbol of symbols) {
        expect(typeof symbol.name).toBe('string');
        expect(typeof symbol.kind).toBe('number');
        expect(symbol.range.start.line).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns an empty array for empty text', () => {
      expect(computeDocumentSymbols('')).toEqual([]);
    });

    it('omits the children key for a symbol without children', () => {
      const symbols = computeDocumentSymbols('"a" => $name\n');

      const name = findSymbol(symbols, 'name');
      expect(name).toBeDefined();
      expect(name !== undefined && 'children' in name).toBe(false);
    });
  });

  describe('performance', () => {
    it('converts a 5,000-line document in under 400 ms on the first call', () => {
      const block = readFixture('perf-block.rill').replace(/\n$/, '');
      const blockLines = block.split('\n').length;
      const text = Array.from({ length: 5000 / blockLines }, () => block).join(
        '\n'
      );
      expect(text.split('\n')).toHaveLength(5000);

      const startedAt = performance.now();
      const symbols = computeDocumentSymbols(text);
      const elapsed = performance.now() - startedAt;

      // 400 ms is the failure line in the requirements; the 200 ms target flakes on
      // one cold sample, as about 1 in 4 fresh processes runs the whole call 3x slower.
      expect(elapsed).toBeLessThan(400);
      expect(symbols.length).toBeGreaterThanOrEqual(500);
      const nested = symbols.reduce(
        (total, symbol) => total + (symbol.children?.length ?? 0),
        0
      );
      expect(nested).toBeGreaterThanOrEqual(100);
    });
  });

  describe('stubbed upstream', () => {
    it('maps only the kind of a nested sentinel outline', () => {
      vi.mocked(documentSymbols).mockImplementationOnce(() => [
        {
          name: 'root',
          kind: 'function',
          range: range(3, 0, 20),
          selectionRange: range(3, 15, 19),
          children: [
            {
              name: 'mid',
              kind: 'field',
              range: range(3, 2, 10),
              selectionRange: range(3, 2, 5),
              children: [
                {
                  name: 'leaf',
                  kind: 'variable',
                  range: range(3, 4, 8),
                  selectionRange: range(3, 4, 8),
                },
              ],
            },
            {
              name: 'bare',
              kind: 'variable',
              range: range(3, 11, 12),
              selectionRange: range(3, 11, 12),
              children: [],
            },
          ],
        },
      ]);

      const symbols = computeDocumentSymbols('1');

      expect(symbols).toStrictEqual([
        {
          name: 'root',
          kind: SymbolKind.Function,
          range: range(3, 0, 20),
          selectionRange: range(3, 15, 19),
          children: [
            {
              name: 'mid',
              kind: SymbolKind.Field,
              range: range(3, 2, 10),
              selectionRange: range(3, 2, 5),
              children: [
                {
                  name: 'leaf',
                  kind: SymbolKind.Variable,
                  range: range(3, 4, 8),
                  selectionRange: range(3, 4, 8),
                },
              ],
            },
            {
              name: 'bare',
              kind: SymbolKind.Variable,
              range: range(3, 11, 12),
              selectionRange: range(3, 11, 12),
              children: [],
            },
          ],
        },
      ]);
    });
  });

  describe('error contracts', () => {
    it('returns an empty array and reports when documentSymbols throws', () => {
      const failure = new Error('symbols failed');
      vi.mocked(documentSymbols).mockImplementationOnce(() => {
        throw failure;
      });
      const onError = vi.fn();

      const symbols = computeDocumentSymbols('"a" => $name\n', onError);

      expect(symbols).toEqual([]);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('returns an empty array and reports when parseWithRecovery throws', () => {
      const failure = new Error('lexer failed');
      vi.mocked(parseWithRecovery).mockImplementationOnce(() => {
        throw failure;
      });
      const onError = vi.fn();

      const symbols = computeDocumentSymbols('"a" => $name\n', onError);

      expect(symbols).toEqual([]);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('returns an empty array without propagating when onError throws', () => {
      vi.mocked(documentSymbols).mockImplementationOnce(() => {
        throw new Error('symbols failed');
      });
      const onError = vi.fn(() => {
        throw new Error('reporter failed');
      });

      const symbols = computeDocumentSymbols('"a" => $name\n', onError);

      expect(symbols).toEqual([]);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array when a failure occurs and no onError is given', () => {
      vi.mocked(parseWithRecovery).mockImplementationOnce(() => {
        throw new Error('lexer failed');
      });

      expect(computeDocumentSymbols('"a" => $name\n')).toEqual([]);
    });
  });
});
