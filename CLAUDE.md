# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@rcrsr/rill-lsp` is the Language Server Protocol server for [rill](https://rill.run). Editors spawn the `rill-lsp` bin and talk JSON-RPC over stdio. It is a thin protocol layer: parsing comes from `@rcrsr/rill`, and analysis (symbols, tokens, formatting, scope, rules) from `@rcrsr/rill-language-service`. Both live in [rcrsr/rill](https://github.com/rcrsr/rill) and release in lockstep, so their ranges in `package.json` always move together.

## Commands

Package manager is pnpm (via Corepack); the supported Node range is the `engines` field in `package.json`.

```bash
pnpm bootstrap             # verify toolchain, install, build (fresh clone entry point)
pnpm install               # install deps (also installs lefthook git hooks)
pnpm build                 # tsc --build, emits to dist/
pnpm test                  # vitest run (all tests)
pnpm test tests/server.test.ts              # single test file
pnpm test -t "pattern"                      # single test by name
pnpm check:types           # tsc --noEmit -p tsconfig.typecheck.json (src/ and tests/)
pnpm check:lint            # oxlint on src/ and tests/
pnpm fix:lint              # oxlint --fix
pnpm check:format          # oxfmt --check
pnpm fix:format            # oxfmt
pnpm check:deps            # knip (unused deps/exports)
pnpm check:standards       # rill-check-standards (add --remote for host settings)
pnpm test:rules            # rill-test-rules (the lint rules' own unit tests)
pnpm check                 # the complete check set (what CI runs across the Node matrix)
```

This is a single package, so it uses the root script vocabulary throughout:
`check:types` and `check:lint`, not bare `typecheck` and `lint`. See
`REPO-STANDARDS.md` §4.

Vitest arguments pass straight through, with no `--` separator. `pnpm test -- tests/server.test.ts` silently runs the *whole* suite instead of the one file, so check the reported file count when filtering.

Linting and formatting use oxlint and oxfmt, not ESLint or Prettier. Lefthook runs format then lint on pre-commit, and typecheck+test on pre-push (skip with `LEFTHOOK=0` only when explicitly instructed).

Always go through the package scripts. `npx <tool>` and `pnpm exec <tool>` bypass the toolchain versions pinned in `devDependencies`.

## Architecture

ESM-only (`"type": "module"`). All intra-package imports use `.js` extensions. Public API is re-exported through `src/index.ts`; tests import `@rcrsr/rill-lsp`, which vitest aliases to `src/index.ts` (see `vitest.config.ts`), so no build is needed before testing.

| Path | Role |
|---|---|
| `src/bin.ts` | stdio entry point. Creates the connection and calls `startServer`. Nothing else. |
| `src/server.ts` | Lifecycle, `SERVER_CAPABILITIES`, document sync, and handler registration. |
| `src/features/*.ts` | One module per LSP request. Pure functions from document text (plus position) to LSP types, testable without a connection. |

Rules a routine change can silently break:

- **Capability and handler land together.** Clients call only what `SERVER_CAPABILITIES` advertises. A handler with no capability is dead code; a capability with no handler errors in every editor.
- **Handlers never throw.** An uncaught error can kill the server process and the user's editor session with it. Return an empty result on bad input.
- **No language logic here.** If a feature needs new parsing or analysis, add it to `@rcrsr/rill-language-service` in rcrsr/rill and consume the release. This repository converts types and positions.
- **Positions are 0-based UTF-16.** rill spans are 1-based. Convert through `spanToRange` from the language service rather than by hand.
- **Never write to stdout.** stdout carries JSON-RPC; use `connection.console.log`. See `conduct/policies/policy-domain-node.md` §NOD.7.
- Clear published diagnostics in `onDidClose`, and prefix notifications with `void`. See `conduct/policies/policy-domain-node.md` §NOD.3.2.
- Exported functions and module-level helpers declare explicit return types so the compiler checks LSP payloads. See `conduct/policies/policy-artifact-typescript.md` §TS.2.1.
- `exactOptionalPropertyTypes` is on: forward optional fields with a conditional spread, `...(x !== undefined ? { x } : {})`.

## Repository standards

This repository conforms to the ecosystem baseline in `REPO-STANDARDS.md`,
which arrives through the `@rcrsr/rill-dev` devDependency rather than as a file
in this tree. Read the installed copy at
`node_modules/@rcrsr/rill-dev/REPO-STANDARDS.md`, or upstream at
[rcrsr/rill](https://github.com/rcrsr/rill/blob/main/packages/dev/REPO-STANDARDS.md).

```bash
pnpm check:standards                        # elements readable from the tree
pnpm exec rill-check-standards --remote     # adds §1 merge gates and §13 repo settings
```

Read the summary line, not the exit code. `--` means an element was **not**
checked; it still applies. A green run covers only the checked subset.

### CI checks the tree; `--remote` is a maintainer task

<!-- rule-level: operational -->

CI runs `check:standards` as the last leg of `pnpm run check`, without
`--remote`. **Do not add it back.** Two independent reasons:

- **A pull request cannot change host state.** Branch protection and repository
  settings are altered out of band by an admin. Gating merges on them means one
  settings change turns every open PR red for a reason no author can fix, which
  teaches everyone to ignore the job.
- **CI credentials cannot read them anyway.** `GITHUB_TOKEN` gets a repository
  object with the administrative fields omitted and a 404 from
  `branches/*/protection`, so the §1 merge-gate and §13 repo-setting elements report as unchecked. The CI
  element count is identical with and without the flag; the step implied
  coverage it did not have. Making it decide anything means a long-lived
  admin-scoped PAT or a GitHub App sitting in the PR path, to check settings a
  PR cannot alter.

Run `pnpm exec rill-check-standards --remote` yourself, from a `gh`-authenticated
shell, when repository settings change. It decides strictly more elements than
any CI run can.

**The shared dev assets are a dependency, not a copy.** `@rcrsr/rill-dev` ships
the checker (`rill-check-standards`), the lint rules
(`@rcrsr/rill-dev/lint-rules`, plus `rill-test-rules` for their own suite), and
`REPO-STANDARDS.md`. A fix to any of them goes to `rcrsr/rill` under
`packages/dev` and arrives here as a version bump. Do not vendor
`REPO-STANDARDS.md` back into the tree; there is nothing to keep in sync and a
copy would only go stale.

`rill-check-standards` resolves the repository under test with
`git rev-parse --show-toplevel`, never from its own location, which is what
makes it correct from inside `node_modules/`. If it looks like it is reading
the wrong tree, the working directory is the cause, not the script. It exits 2
rather than reporting on a directory with no manifest.

`scripts/bootstrap.sh` stays a local file: it performs the install that fetches
`@rcrsr/rill-dev`, so it cannot ship inside its own prerequisite.

### Recorded N/A

Each entry names the element ID and the stated condition from
`REPO-STANDARDS.md` that it meets. An N/A claimed without a matching stated
condition is a defect, not a decision.

| ID | Stated condition it meets |
|---|---|
| STD-CHK-7 | "The repository publishes exactly one package and has no root-versus-package version split to reconcile." One package, published from the root manifest. There is no root-vs-package pair to reconcile, so there is no version gate for CI to run. Tag-vs-manifest consistency is a different assertion and is enforced by STD-REL-2 in `release.yml`. |
| STD-SCRIPT-3 | "The same condition as STD-CHK-7." No `check:versions` / `fix:versions`, for the reason above. |
| STD-SCRIPT-7 | "The repository is a single package." There are no workspace packages to carry the atomic vocabulary. The single package is the root and takes the root vocabulary from STD-SCRIPT-1 (`check:types`, `check:lint`), not the bare package names. |
| STD-PM-7 | **Satisfied vacuously, not N/A by the stated condition.** That condition reads "single package with no workspace file", and this repository *does* have a `pnpm-workspace.yaml`: it declares no `packages:` key and carries pnpm settings only, which pnpm reads either way. So the file exists, it lists no globs, and "every workspace glob matches" holds with nothing to check. The checker reports it as `--`. Do not read this row as meeting the written condition; a settings-only workspace file is a shape that condition does not describe. |
| STD-DEP-4 | "The repository is a single package." Vitest is declared once, in the only manifest, so there is no per-package consistency to keep. |
| STD-DEP-5 | "The repository has no cross-repository peer dependency." `@rcrsr/rill` and `@rcrsr/rill-language-service` are regular `dependencies`, because the server is an application: editors spawn it, and nothing hosts it. STD-CI-9 still covers drift through `compatibility.yml`. |

STD-PM-6 and STD-SUP-4 are always-applicable and satisfied rather than N/A. These are machine-checked and report `ok`; the notes stay because they carry the reasoning
for the shape the checker accepts, which a passing line does not:

- **STD-PM-6.** Verified against the pinned major, pnpm 12.3.4: since pnpm 11 it no
  longer reads `pnpm.onlyBuiltDependencies` from `package.json` and warns
  "Ignored build scripts" when the allowlist is absent. The allowlist is
  `allowBuilds` in `pnpm-workspace.yaml`, which is where 11 and 12 expect it.
  pnpm 12 also rejects unrecognized keys in that file
  (`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`), so a misspelled setting fails
  the install instead of being silently ignored. As of rill-dev 0.2.0 the
  checker decides this from the tree, reading the pinned pnpm major to know
  which of the two locations is load-bearing; before then it reported `--`.
- **STD-SUP-4.** `minimumReleaseAgeExclude` names `@rcrsr/rill`,
  `@rcrsr/rill-language-service`, and `@rcrsr/rill-dev` by name, not by exact version, so they survive the next release with no hand edit. All of them are first-party; the rationale for each is in
  `pnpm-workspace.yaml`.

### Which `rill/*` lint rules are on

Loading `@rcrsr/rill-dev/lint-rules` through `jsPlugins` registers the rules
without enabling any of them, so each is a deliberate opt-in in
`.oxlintrc.json`. `rill/no-spec-id-reference` and `rill/no-duplicate-error-id` are on, scoped to `src/**/*.ts`.

- **`rill/no-spec-id-reference`.** `src/` is what anyone reading the published
  package sees, and internal planning identifiers are unresolvable there.
  STD-LINT-3 requires it whether or not this repository has anything to leak.
- **`rill/no-duplicate-error-id`.** This one matches nothing today: it binds to
  the bare identifier `RuntimeError` and to `RuntimeError.fromNode`, and this
  package constructs no rill errors. It is on anyway. A no-op
  rule costs nothing, whereas switching it off fails silently — the day a module
  imports rill's `RuntimeError`, nobody will remember the rule existed.

Verify the plugin resolves through `node_modules` rather than a path:

```bash
node -e "import('@rcrsr/rill-dev/lint-rules').then(m => console.log(Object.keys(m.default.rules)))"
# [ 'no-duplicate-error-id', 'no-spec-id-reference' ]
```

Note `m.default.rules`, not `m.rules`: the plugin is a default export
(`export default { meta, rules }`), so the module namespace carries `default`.

### Host settings, which no checkout can enforce

Merge gates (§1) and repository settings (§13) live on GitHub, so nothing in a
diff reveals a change to them. Re-check with:

```bash
gh api repos/rcrsr/rill-lsp/branches/main/protection \
  --jq '.required_status_checks | {strict, contexts}'
gh api repos/rcrsr/rill-lsp \
  --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit,
         rebase: .allow_rebase_merge, wiki: .has_wiki,
         delete_branch: .delete_branch_on_merge}'
```

The intent: `main` protected with admins included and force pushes off; linear
history on; squash the only enabled merge path; `delete_branch_on_merge` on;
every leg of the CI `check` matrix a required context, with `strict` on.
