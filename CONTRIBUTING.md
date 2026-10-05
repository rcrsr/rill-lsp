# Contributing to rill-lsp

Thanks for your interest in `@rcrsr/rill-lsp`. This guide covers setup, the change process, and the standards a pull request must meet before review.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports follow the [Security Policy](SECURITY.md) instead of the process below.

## Before you write code

**Open an issue first for anything non-trivial.** Bug fixes and typo corrections can go straight to a pull request. Everything else starts as an issue so the design gets settled before you invest in an implementation.

Use the templates under `.github/ISSUE_TEMPLATE/`. Pick the one that matches: bug, feature, chore, security, or idea. `.github/labeler.yml` is the one-stop reference for the label taxonomy.

For a new LSP capability or a change to the public surface, expect a design discussion in the issue. That discussion produces an agreed contract: which request the handler serves, what the server advertises, and how the work splits across pull requests. Wait for that agreement before writing the implementation.

**Follow the agreed design.** If you find a reason to depart from it while implementing, say so in the issue or the pull request description. An unflagged deviation costs a review cycle and sometimes a rewrite. A flagged one usually just updates the plan.

**Security work follows the [Security Policy](SECURITY.md).** Its [threat model](SECURITY.md#threat-model) covers what counts as a vulnerability, from code execution to resource exhaustion.

Report a vulnerability in a published release privately through the [Security tab](https://github.com/rcrsr/rill-lsp/security/advisories/new), not as a public issue. Hardening work on unreleased code uses the Security issue template.

## Setup

Node and pnpm floors are the `engines` field in `package.json`; `.nvmrc` and `.node-version` name the version this repository develops against.

```bash
git clone https://github.com/rcrsr/rill-lsp.git
cd rill-lsp
corepack enable
pnpm bootstrap
```

`pnpm bootstrap` verifies the toolchain, installs with a frozen lockfile, and builds. It is safe to re-run. Installing also wires the git hooks through `prepare`.

## Repository layout

`src/server.ts` owns the connection: lifecycle, capability negotiation, and document sync. `src/features/` holds one module per LSP request, each a thin adapter from `@rcrsr/rill` and `@rcrsr/rill-language-service` results to LSP types. `src/bin.ts` is the stdio entry point editors spawn. `tests/` mirrors `src/`.

`scripts/` holds the one shared script that cannot be a dependency: `bootstrap.sh` performs the install, so it cannot ship inside a package that install fetches.

The rest of the shared dev assets — the conformance checker, the custom oxlint rules, and `REPO-STANDARDS.md` — come from the `@rcrsr/rill-dev` devDependency. **They are not in this tree, and nothing here should copy them into it.** A fix goes to `rcrsr/rill` under `packages/dev` and arrives here as a version bump.

## Commands

Full detail is in [CLAUDE.md](CLAUDE.md). The ones a contributor needs:

```bash
pnpm check                 # the complete check set; must pass before review
pnpm test                  # vitest run
pnpm test tests/server.test.ts   # one file
pnpm check:standards       # repository conformance
pnpm test:rules            # the custom oxlint rules' own unit tests
pnpm fix:format            # oxfmt
```

`pnpm exec rill-check-standards --remote` adds the merge gates and repository settings, which live on GitHub and so are invisible to `pnpm check:standards`. It needs `gh` authenticated; without it those elements report as unchecked rather than failing.

Vitest arguments pass straight through with no `--` separator. `pnpm test -- tests/server.test.ts` silently runs the *whole* suite, and a full green run looks just like a passing filtered one, so check the reported file count when filtering.

Always go through the package scripts. `npx <tool>` and `pnpm exec <tool>` bypass the versions pinned in `devDependencies`.

## The bar for a pull request

**`pnpm check` must pass locally before you request review.** This is the single most common reason a pull request stalls. Do not rely on CI to find a broken build for you.

Two failure modes worth calling out, because neither is obvious:

1. **A test file that fails to import reports as a file-level failure, not as failing tests.** A suite that never collects can read as "no failures" at a glance. Confirm your tests actually execute and that the count is what you expect.
2. **`pnpm check:standards` is part of `pnpm check`.** A change to a workflow, a manifest field, or a lint setting can fail conformance without touching any TypeScript.

Other expectations:

- **Wire the change end to end.** Code that nothing calls is not a reviewable increment.
- **Advertise a capability in the same change as its handler.** Clients invoke only what `SERVER_CAPABILITIES` in `src/server.ts` lists. A handler with no capability never runs; a capability with no handler fails in every editor.
- **Keep language logic out of this repository.** Parsing and analysis belong in `@rcrsr/rill` and `@rcrsr/rill-language-service`. A handler here converts types and positions; anything more lands upstream.
- **Never throw from a request handler.** An uncaught error can take down the server, and with it the user's editor session. Return an empty result instead.
- **Let the formatter handle style.** `oxfmt` runs on commit. Do not hand-format, and do not fight it.

## Tests

Tests import the public package (`@rcrsr/rill-lsp`) rather than `../src/*.js`, unless the symbol is `@internal`.

### Write tests that could fail

A test that passes before your implementation exists is measuring something else. Before opening a pull request, check that each new test fails for the right reason when the change is reverted.

This matters most for tests of the happy path. "A valid script has no diagnostics" often passes against untouched default behaviour and demonstrates nothing.

### Test broken input

Language servers see broken input far more often than valid input. For every handler, cover:

- **Broken documents.** Unclosed brackets, a half-typed expression, an empty file. The handler must return a result, not throw.
- **Positions at the edges.** Line 0, column 0, the last character, and a position past the end of the document.
- **Multi-byte text.** LSP positions count UTF-16 code units. A test with only ASCII cannot catch an off-by-one on an emoji or a CJK character.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with an area scope drawn from `.github/labeler.yml`:

```
feat(features): add hover for variables
fix(protocol): clear diagnostics when a document closes
docs: add Neovim client configuration
chore: release vX.Y.Z
```

Write the subject as a description of the change. State what the code does now, not how many files you touched.

`lefthook` runs formatting then lint with auto-fix before each commit, and typecheck plus the full test suite before each push. Skip with `LEFTHOOK=0` only when you have a specific reason.

## Pull requests

1. Branch from `main`. Name it for the work, for example `fix/diagnostics-on-close` or `docs/contributing-guide`.
2. Keep it scoped to one concern. A large change splits into a sequence of pull requests, agreed in the issue.
3. Describe the change in terms of source files, exported APIs, and behaviour. Link the issue it implements. `.github/PULL_REQUEST_TEMPLATE.md` has the shape.
4. Area labels apply automatically from the paths you touched, via `.github/labeler.yml`.
5. CI runs `pnpm check` across every Node version in the matrix in `.github/workflows/ci.yml`, plus CodeQL and dependency review. All must pass.

Expect review comments to cite specific lines and to include the command or grep that verifies the claim. Reply in the same register. If you disagree with a finding, say why and show the evidence.

## Documentation

`README.md` carries the capability table and editor setup, and is the published surface. Every new capability belongs in that table in the same release. `CLAUDE.md` carries repository conventions and the recorded conformance exceptions.

## Releases

Maintainers publish `@rcrsr/rill-lsp` by tagging a release commit on `main`. The tag must match `package.json`'s version; the release workflow fails otherwise. The `@rcrsr/rill` and `@rcrsr/rill-language-service` ranges move together, in lockstep with the matching rill minor.

Contributors do not need to bump versions in a pull request.

## License

`@rcrsr/rill-lsp` is MIT licensed. By contributing, you agree that your contributions are licensed under the same terms. See [LICENSE](LICENSE).
