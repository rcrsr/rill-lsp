# @rcrsr/rill-lsp

*Language Server Protocol server for the [rill](https://rill.run) scripting language*

`rill-lsp` gives any LSP-capable editor live feedback on `.rill` files. It speaks JSON-RPC over stdio and reuses rill's own parser (`@rcrsr/rill`) and language service (`@rcrsr/rill-language-service`), so the editor reports exactly what the runtime would.

## Status

Early. The server runs and reports parse errors. The remaining features in the table below are in progress.

| Capability | LSP method | Status |
|---|---|---|
| Parse diagnostics | `textDocument/publishDiagnostics` | Shipped |
| Document outline | `textDocument/documentSymbol` | Planned |
| Semantic highlighting | `textDocument/semanticTokens/full` | Planned |
| Formatting | `textDocument/formatting` | Planned |
| Hover | `textDocument/hover` | Planned |
| Go to definition | `textDocument/definition` | Planned |
| Completion | `textDocument/completion` | Planned |
| Static-check diagnostics | `textDocument/publishDiagnostics` | Planned |

The server advertises only shipped capabilities, so an editor never calls a method it cannot answer.

## Install

Requires Node.js 22.16 or later.

```bash
npm install -g @rcrsr/rill-lsp
```

Or run it without installing:

```bash
npx @rcrsr/rill-lsp
```

## Editor setup

Every editor spawns the same command: `rill-lsp`, communicating over stdio.

### Neovim (0.11+)

```lua
vim.lsp.config('rill', {
  cmd = { 'rill-lsp' },
  filetypes = { 'rill' },
  root_markers = { '.git' },
})
vim.filetype.add({ extension = { rill = 'rill' } })
vim.lsp.enable('rill')
```

### Emacs (eglot)

```elisp
(define-derived-mode rill-mode prog-mode "rill")
(add-to-list 'auto-mode-alist '("\\.rill\\'" . rill-mode))
(add-to-list 'eglot-server-programs '(rill-mode "rill-lsp"))
```

## Programmatic use

The package also exports the server pieces, for hosts that embed the server or test against it.

| Export | Description |
|---|---|
| `startServer(connection)` | Wires every rill feature onto an LSP `Connection` and starts listening. The caller owns the transport. |
| `SERVER_CAPABILITIES` | The `ServerCapabilities` object returned from `initialize`. |
| `computeDiagnostics(text)` | Parses `text` with error recovery and returns LSP `Diagnostic[]`. Never throws. |

```ts
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { startServer } from '@rcrsr/rill-lsp';

startServer(createConnection(ProposedFeatures.all));
```

## Diagnostics

Each diagnostic carries the rill error ID as its `code` (for example `RILL-P007`) and links the error reference through `codeDescription.href`. Recovery parsing reports one diagnostic per broken statement, so an error early in a file does not hide later ones.

## Related packages

| Package | Purpose |
|---|---|
| [`@rcrsr/rill`](https://www.npmjs.com/package/@rcrsr/rill) | Language runtime and parser |
| [`@rcrsr/rill-language-service`](https://www.npmjs.com/package/@rcrsr/rill-language-service) | Outline, tokens, formatting, scope, hover, completion, static checker |
| [`@rcrsr/rill-cli`](https://www.npmjs.com/package/@rcrsr/rill-cli) | `rill` command-line tools |

## License

MIT
