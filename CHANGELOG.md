# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Language server over stdio:** the `rill-lsp` bin starts a JSON-RPC server with incremental document sync.
- **Parse diagnostics:** every open `.rill` document is parsed with `parseWithRecovery` on each change. Each parse error becomes a diagnostic carrying the rill error ID and a link to its reference page. Closing a document clears its diagnostics.
- **Programmatic API:** `startServer`, `SERVER_CAPABILITIES`, and `computeDiagnostics` are exported from the package root.
