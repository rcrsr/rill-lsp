import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  documentSymbols,
  semanticTokens,
  type ServiceTokenType,
  type SymbolKind as ServiceSymbolKind,
} from '@rcrsr/rill-language-service';
import {
  SERVER_CAPABILITIES,
  computeDocumentSymbols,
  computeSemanticTokens,
} from '@rcrsr/rill-lsp';

vi.mock('@rcrsr/rill-language-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@rcrsr/rill-language-service')>();
  return {
    ...actual,
    semanticTokens: vi.fn(actual.semanticTokens),
    documentSymbols: vi.fn(actual.documentSymbols),
  };
});

const DOC = readFileSync(
  new URL('../docs/clients/neovim.md', import.meta.url),
  'utf8'
);

// Typed records fail type-checking when upstream adds or removes a member.
const SERVICE_TOKEN_TYPES = Object.keys({
  keyword: true,
  operator: true,
  string: true,
  number: true,
  bool: true,
  comment: true,
  variableName: true,
  functionName: true,
  punctuation: true,
  bracket: true,
  meta: true,
  typeName: true,
} satisfies Record<ServiceTokenType, true>) as ServiceTokenType[];

const SERVICE_KINDS = Object.keys({
  variable: true,
  function: true,
  field: true,
} satisfies Record<ServiceSymbolKind, true>) as ServiceSymbolKind[];

const LEGEND_TYPES =
  SERVER_CAPABILITIES.semanticTokensProvider.legend.tokenTypes;
const TOKEN_FIELDS = 5;
const OMITTED = 'omitted';

type Row = string[];

function stripCell(cell: string): string {
  return cell.trim().replace(/^`(.*)`$/, '$1');
}

// Returns every table body row in the document as its stripped cells.
function tableRows(markdown: string): Row[] {
  return markdown
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(stripCell)
    )
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)));
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const rest = markdown.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

// Runs the real feature with the service stubbed to one token per member,
// member i on line i, and pairs each member with its decoded legend type.
function tokenPairs(): [ServiceTokenType, string][] {
  vi.mocked(semanticTokens).mockImplementationOnce(() =>
    SERVICE_TOKEN_TYPES.map((tokenType, index) => ({
      deltaLine: index === 0 ? 0 : 1,
      deltaStart: 0,
      length: 1,
      tokenType,
      tokenModifiers: 0,
    }))
  );
  const { data } = computeSemanticTokens('x');
  const typeByLine = new Map<number, string>();
  let line = 0;
  for (let i = 0; i < data.length; i += TOKEN_FIELDS) {
    line += data[i] ?? 0;
    typeByLine.set(line, LEGEND_TYPES[data[i + 3] ?? -1] ?? '');
  }
  return SERVICE_TOKEN_TYPES.map((member, index) => [
    member,
    typeByLine.get(index) ?? OMITTED,
  ]);
}

function kindPairs(): [ServiceSymbolKind, string][] {
  const zero = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
  vi.mocked(documentSymbols).mockImplementationOnce(() =>
    SERVICE_KINDS.map((kind) => ({
      name: kind,
      kind,
      range: zero,
      selectionRange: zero,
    }))
  );
  return computeDocumentSymbols('x').map((symbol) => [
    symbol.name as ServiceSymbolKind,
    String(symbol.kind),
  ]);
}

afterEach(() => {
  vi.mocked(semanticTokens).mockReset();
  vi.mocked(documentSymbols).mockReset();
});

describe('neovim client doc', () => {
  describe('semantic token mapping table', () => {
    const rows = tableRows(section(DOC, 'Semantic tokens'));

    it('pairs every service token type with its legend type in exactly one row', () => {
      const pairs = tokenPairs();
      expect(pairs).toHaveLength(SERVICE_TOKEN_TYPES.length);
      for (const [member, expected] of pairs) {
        const holding = rows.filter(
          (row) => row[0] === member && row[1] === expected
        );
        expect(holding.map((row) => row.join(' -> '))).toEqual([
          `${member} -> ${expected}`,
        ]);
      }
    });

    it('has no row pairing a service token type with another value', () => {
      const expected = new Map(tokenPairs());
      for (const row of rows) {
        const member = row[0] as ServiceTokenType;
        if (!expected.has(member)) continue;
        expect(`${member} -> ${row[1]}`).toBe(
          `${member} -> ${expected.get(member)}`
        );
      }
      const memberRows = rows.filter((row) =>
        expected.has(row[0] as ServiceTokenType)
      );
      expect(memberRows).toHaveLength(SERVICE_TOKEN_TYPES.length);
    });

    it('lists every advertised legend type in some row', () => {
      for (const legendType of LEGEND_TYPES) {
        expect(
          rows.filter((row) => row[1] === legendType).length
        ).toBeGreaterThan(0);
      }
    });
  });

  describe('symbol kind table', () => {
    const rows = tableRows(section(DOC, 'Document symbols'));

    it('pairs every service kind with its numeric value in exactly one row', () => {
      const pairs = kindPairs();
      expect(pairs).toHaveLength(SERVICE_KINDS.length);
      for (const [kind, value] of pairs) {
        const holding = rows.filter(
          (row) => row[0] === kind && row[1] === value
        );
        expect(holding.map((row) => `${row[0]} -> ${row[1]}`)).toEqual([
          `${kind} -> ${value}`,
        ]);
      }
    });

    it('has no row pairing a service kind with another value', () => {
      const expected = new Map(kindPairs());
      const kindRows = rows.filter((row) =>
        expected.has(row[0] as ServiceSymbolKind)
      );
      expect(kindRows).toHaveLength(SERVICE_KINDS.length);
      for (const row of kindRows) {
        expect(`${row[0]} -> ${row[1]}`).toBe(
          `${row[0]} -> ${expected.get(row[0] as ServiceSymbolKind)}`
        );
      }
    });
  });

  describe('formatting notes', () => {
    const formatting = section(DOC, 'Formatting');

    it('states CRLF becomes LF', () => {
      expect(formatting).toMatch(/CRLF[^.\n]*converted to LF/);
    });

    it('states trailing whitespace is trimmed', () => {
      expect(formatting).toMatch(/Trailing spaces and tabs are trimmed/);
    });

    it('states FormattingOptions are ignored and no indentation is applied', () => {
      expect(formatting).toMatch(/ignores `FormattingOptions`/);
      expect(formatting).toMatch(/never applies indentation or tab size/);
    });
  });

  describe('structure', () => {
    it('has one section per feature variant', () => {
      for (const heading of [
        'Setup',
        'Diagnostics',
        'Semantic tokens',
        'Document symbols',
        'Formatting',
      ]) {
        const count = DOC.split('\n').filter(
          (line) => line === `## ${heading}`
        ).length;
        expect(`${heading}: ${count}`).toBe(`${heading}: 1`);
      }
    });

    it('configures the server with the config and enable API', () => {
      expect(DOC).toContain('vim.lsp.config(');
      expect(DOC).toContain("vim.lsp.enable('rill')");
      expect(DOC).toContain('vim.filetype.add(');
      expect(DOC).not.toContain('vim.lsp.start');
    });
  });
});
