import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { computeDiagnostics } from '@rcrsr/rill-lsp';

describe('computeDiagnostics', () => {
  it('returns no diagnostics for a valid script', () => {
    expect(computeDiagnostics('1 -> $x\n')).toEqual([]);
  });

  it('reports a parse error with a 0-based range and the rill error id', () => {
    const [diagnostic] = computeDiagnostics('list [1, 2]\n');

    expect(diagnostic?.severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostic?.source).toBe('rill');
    expect(diagnostic?.code).toMatch(/^RILL-P\d{3}$/);
    expect(diagnostic?.range.start.line).toBe(0);
  });

  it('reports one diagnostic per broken statement', () => {
    const diagnostics = computeDiagnostics('list [1]\n"ok"\nlist [2]\n');

    expect(diagnostics.map((d) => d.range.start.line)).toEqual([0, 2]);
  });
});
