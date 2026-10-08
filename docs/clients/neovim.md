# Neovim

`rill-lsp` works with Neovim 0.11 or later through the built-in LSP client. No plugin is required.

## Setup

Register the `.rill` filetype, define the server, and enable it. Put this in your `init.lua`.

```lua
vim.filetype.add({ extension = { rill = 'rill' } })

vim.lsp.config('rill', {
  cmd = { 'rill-lsp' },
  filetypes = { 'rill' },
  root_markers = { '.git' },
})

vim.lsp.enable('rill')
```

`cmd` is the command Neovim spawns; the server speaks JSON-RPC over stdio. Use `rill-lsp` when the package is installed globally. To run it without installing, use `npx`:

```lua
vim.lsp.config('rill', {
  cmd = { 'npx', '--yes', '@rcrsr/rill-lsp' },
  filetypes = { 'rill' },
  root_markers = { '.git' },
})
```

## Diagnostics

Parse errors appear as diagnostics with no further configuration. Use `vim.diagnostic.open_float()` to read the message under the cursor.

## Semantic tokens

Semantic highlighting is on by default in Neovim 0.11. The server advertises a legend of nine token types, and Neovim exposes each as a highlight group named `@lsp.type.<type>.rill`. Override a group to restyle a token type:

```lua
vim.api.nvim_set_hl(0, '@lsp.type.function.rill', { link = 'Function' })
vim.api.nvim_set_hl(0, '@lsp.type.enumMember.rill', { link = 'Special' })
```

Each rill token type maps to one LSP token type, or is omitted from the output:

| rill token type | LSP type   |
| --------------- | ---------- |
| `keyword`       | `keyword`  |
| `operator`      | `operator` |
| `string`        | `string`   |
| `number`        | `number`   |
| `comment`       | `comment`  |
| `variableName`  | `variable` |
| `functionName`  | `function` |
| `typeName`      | `type`     |
| `bool`          | `keyword`  |
| `meta`          | `enumMember` |
| `punctuation`   | omitted    |
| `bracket`       | omitted    |

Highlighting clears while the document has a lexer error, such as an unterminated string. It returns once the error is fixed.

## Document symbols

Open the outline of the current buffer with:

```vim
:lua vim.lsp.buf.document_symbol()
```

Symbols are hierarchical. A variable captured inside a closure nests under the closure's function symbol, and entries of a nested dict nest as field children of their parent. Selecting a captured variable in the outline jumps to the capture name.

Each symbol kind maps to an LSP `SymbolKind` number:

| Kind       | LSP SymbolKind |
| ---------- | -------------- |
| `variable` | 13             |
| `function` | 12             |
| `field`    | 8              |

## Formatting

Format the buffer on save with an autocmd:

```lua
vim.api.nvim_create_autocmd('BufWritePre', {
  pattern = '*.rill',
  callback = function()
    vim.lsp.buf.format({ name = 'rill' })
  end,
})
```

Formatting changes whitespace and line endings only:

- Trailing spaces and tabs are trimmed from every line.
- CRLF line endings are converted to LF.
- Indentation and the spacing around operators are never changed.
- String literal interiors and malformed regions the parser recovered from are left untouched.

The server ignores `FormattingOptions`. Neovim's `tabstop`, `shiftwidth`, and `expandtab` have no effect, and the formatter never applies indentation or tab size even when the client requests them. The server always returns one edit that replaces the whole document, including when nothing changed.

Neovim's `'fileformat'` option governs the line endings written to disk. A buffer set to `dos` is written back with CRLF regardless of the LF the formatter produced.
