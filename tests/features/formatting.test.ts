import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextEdit } from 'vscode-languageserver';
import { parseWithRecovery } from '@rcrsr/rill';
import { formatDocument } from '@rcrsr/rill-language-service';
import { computeFormattingEdits } from '@rcrsr/rill-lsp';

vi.mock('@rcrsr/rill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rcrsr/rill')>();
  return { ...actual, parseWithRecovery: vi.fn(actual.parseWithRecovery) };
});

vi.mock('@rcrsr/rill-language-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@rcrsr/rill-language-service')>();
  return { ...actual, formatDocument: vi.fn(actual.formatDocument) };
});

const PERF_LINE_COUNT = 5000;

function buildPerfDocument(): string {
  const block = readFileSync(
    new URL('../fixtures/perf-block.rill', import.meta.url),
    'utf8'
  )
    .replace(/\n$/, '')
    .split('\n');
  const lines: string[] = [];
  while (lines.length < PERF_LINE_COUNT) {
    lines.push(...block);
  }
  return lines.slice(0, PERF_LINE_COUNT).join('\n');
}

// Final position computed from the text itself: last line index and its
// length in UTF-16 units, where a line ends at \n, \r\n, or a lone \r.
function finalPosition(text: string): { line: number; character: number } {
  const lines = text.split(/\r\n|\n|\r/);
  const last = lines[lines.length - 1] ?? '';
  return { line: lines.length - 1, character: last.length };
}

function singleEdit(edits: TextEdit[]): TextEdit {
  expect(edits).toHaveLength(1);
  return edits[0] as TextEdit;
}

describe('computeFormattingEdits', () => {
  beforeEach(() => {
    vi.mocked(parseWithRecovery).mockClear();
    vi.mocked(formatDocument).mockClear();
  });

  it('formats a 5000-line document within 200 ms on the first call', () => {
    const input = buildPerfDocument();
    const trailing = input.split('\n').filter((l) => /[ \t]$/.test(l));
    expect(input.split('\n')).toHaveLength(PERF_LINE_COUNT);
    expect(trailing.length).toBeGreaterThanOrEqual(500);

    const start = performance.now();
    const edits = computeFormattingEdits(input);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(singleEdit(edits).newText).not.toBe(input);
  });

  it('normalizes CRLF and trailing whitespace with one whole-document edit', () => {
    const input = 'a => $x  \r\nb => $y\t\nc => $z \r\n';

    const edit = singleEdit(computeFormattingEdits(input));

    expect(edit.range.start).toEqual({ line: 0, character: 0 });
    expect(edit.range.end).toEqual(finalPosition(input));
    expect(edit.newText).not.toContain('\r\n');
    for (const line of edit.newText.split('\n')) {
      expect(line).not.toMatch(/[ \t]$/);
    }
  });

  it('preserves whitespace inside string literals byte-for-byte', () => {
    const input = '"a  b\t" => $s  \n';

    const edit = singleEdit(computeFormattingEdits(input));

    expect(edit.newText).toContain('"a  b\t"');
  });

  it('returns a well-formed edit list for lexer-invalid input without throwing', () => {
    const input = 'ok => $x \n"unterminated \u0001 @@ ``\n';

    const edits = computeFormattingEdits(input);

    expect(Array.isArray(edits)).toBe(true);
    for (const edit of edits) {
      expect(typeof edit.newText).toBe('string');
      expect(edit.range.start.line).toBeGreaterThanOrEqual(0);
      expect(edit.range.end.line).toBeGreaterThanOrEqual(edit.range.start.line);
    }
  });

  it('returns an empty-range empty edit for an empty document', () => {
    const edit = singleEdit(computeFormattingEdits(''));

    expect(edit.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });
    expect(edit.newText).toBe('');
  });

  it('returns one edit equal to the input for an already formatted document', () => {
    const input = '"hello" => $greeting\n42 => $count\n';

    const edit = singleEdit(computeFormattingEdits(input));

    expect(edit.newText).toBe(input);
  });

  it('ends the range at the true final position without a trailing newline', () => {
    const input = 'a => $x \nb => $y';

    const edit = singleEdit(computeFormattingEdits(input));

    expect(edit.range.end).toEqual({ line: 1, character: 'b => $y'.length });
  });

  it('ends the range at the true final position for a CRLF-terminated document', () => {
    const input = 'a => $x\r\nb => $y\r\n';

    const edit = singleEdit(computeFormattingEdits(input));

    expect(edit.range.end).toEqual({ line: 2, character: 0 });
  });

  it('returns the language service edit unchanged', () => {
    const sentinel: TextEdit = {
      range: {
        start: { line: 3, character: 1 },
        end: { line: 4, character: 2 },
      },
      newText: 'sentinel',
    };
    vi.mocked(formatDocument).mockImplementationOnce(() => [sentinel]);

    const edits = computeFormattingEdits('1 => $x\n');

    expect(edits).toEqual([sentinel]);
  });

  it('returns an empty list and reports the error when formatting throws', () => {
    const failure = new Error('format failed');
    const onError = vi.fn();
    vi.mocked(formatDocument).mockImplementationOnce(() => {
      throw failure;
    });

    const edits = computeFormattingEdits('1 => $x\n', onError);

    expect(edits).toEqual([]);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('returns an empty list and reports the error when parsing throws', () => {
    const failure = new Error('parse failed');
    const onError = vi.fn();
    vi.mocked(parseWithRecovery).mockImplementationOnce(() => {
      throw failure;
    });

    const edits = computeFormattingEdits('1 => $x\n', onError);

    expect(edits).toEqual([]);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('returns an empty list without propagating when the error callback throws', () => {
    vi.mocked(formatDocument).mockImplementationOnce(() => {
      throw new Error('format failed');
    });
    const onError = vi.fn(() => {
      throw new Error('reporter failed');
    });

    const edits = computeFormattingEdits('1 => $x\n', onError);

    expect(edits).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when formatting throws and no callback is given', () => {
    vi.mocked(formatDocument).mockImplementationOnce(() => {
      throw new Error('format failed');
    });

    expect(computeFormattingEdits('1 => $x\n')).toEqual([]);
  });
});
