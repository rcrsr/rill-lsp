# Security Policy

`@rcrsr/rill-lsp` is a language server. Editors start it automatically when a user opens a `.rill` file, including files in repositories the user has just cloned and not reviewed. The server therefore processes untrusted input by default, and its trust boundary is a first-class concern rather than a subcategory of bugs. This policy describes what counts as a vulnerability, how to report one, and what to expect afterwards.

## Supported versions

Only the latest published release is supported. Fixes land there, and there are no backports to earlier releases.

Reproduce on the current release before reporting. If you cannot upgrade, say so in the report and give the version you tested. A defect that is already fixed still tells us the fix needs a clearer changelog entry.

The current version is on the [npm package page](https://www.npmjs.com/package/@rcrsr/rill-lsp) and in [CHANGELOG.md](CHANGELOG.md).

This policy covers `@rcrsr/rill-lsp`, the only package published from this repository. The runtime, the extensions, the agent framework, and the CLI are separate repositories with their own policies.

## Reporting a vulnerability

Report privately through GitHub, on the [Security tab](https://github.com/rcrsr/rill-lsp/security/advisories/new) of this repository. That opens a private advisory visible only to you and the maintainers.

Do not open a public issue for a vulnerability in a published release.

Include:

- The version you tested, and whether you reproduced it on the current release
- A minimal reproduction: the smallest `.rill` document or LSP request sequence that shows the behaviour
- What an editor user loses as a result, stated concretely
- The editor, its version, and any client configuration the reproduction depends on

**Do not post working exploit payloads against a live host.** Describe the class of issue and give a minimal reproduction against a local workspace instead.

## What to expect

| Stage | Target |
|-------|--------|
| Acknowledgement | 5 days |
| Initial assessment | 14 days |
| Fix or mitigation plan for a confirmed report | 30 days |

This package is maintained by a small team, so these are targets rather than guarantees. If a report goes quiet past acknowledgement, a nudge on the advisory thread is welcome.

On a confirmed report, the maintainers publish a GitHub Security Advisory, release a patched version, and credit you by name or handle unless you ask otherwise.

## Threat model

The premise is that an editor starts the server over stdio and sends it documents from a workspace the user may not fully trust. The editor chooses the workspace. The documents choose their own content.

### In scope

- **Code execution from a document.** Any path by which opening, editing, or hovering in a `.rill` document executes rill code, host functions, or extension modules. The server parses and analyses; it never runs a script.
- **File access outside the workspace.** Reading or writing a file the client did not send and the workspace does not contain.
- **Resource exhaustion.** Unbounded allocation, a hang, or a crash on an adversarial document or request, including deeply nested constructs and oversized inputs. A hung server blocks the user's editor.
- **Protocol abuse.** A malformed JSON-RPC message crashing the server or corrupting state for other open documents.
- **Supply chain.** Anything in the published package contents or the release pipeline that lets a third party alter what consumers install.

### Out of scope

- **Parser and analysis defects in `@rcrsr/rill` or `@rcrsr/rill-language-service`.** Report those against [rcrsr/rill](https://github.com/rcrsr/rill/security/advisories/new). Report here when this server amplifies them, for example by not isolating a crash.
- **A hostile editor or client.** The client spawns the server and already controls the process.
- **Findings from a scanner with no demonstrated impact on a running server.**

If you are unsure which side a finding falls on, report it. A borderline report that turns out to be by-design costs less than an unreported bypass.
