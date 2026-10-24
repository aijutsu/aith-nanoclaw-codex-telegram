# Remove the dependency installer

Reverses everything apply added: both scripts, both make targets, the
installer-shell widening and the installer's provenance key.

This removes the *tooling*, not the tools. Homebrew, git, jq, Docker, Node,
pnpm and Codex stay where they are, and so does `~/nanoclaw`. To take those
off the machine, run `make uninstall` **before** removing this skill — that is
what it is for, and once these files are gone there is nothing left that knows
which of them were installed for NanoClaw.

## 1. Remove the make targets

Delete both appended blocks from `Makefile`, including their `.PHONY`
declarations and leading `##` comments:

```make
## Install every prerequisite the course documents — Homebrew, git, jq, Docker,
## Make, Node, pnpm, Codex — then host dependencies and the agent image. Checks
## first and only installs what is missing. The one recipe that is not a
## `pnpm exec` call: it has to run before Node and pnpm exist.
.PHONY: install-deps
install-deps:
	@bash install-dependencies.sh

## Uninstall this copy. Hands NanoClaw itself to nanoclaw.sh --uninstall, then
## walks the course prerequisites one at a time, offering only what it can prove
## this installer put there. Nothing is removed without a y/N; --check previews.
.PHONY: uninstall
uninstall:
	@bash uninstall-dependencies.sh
```

Also restore the file header's note to its original two lines, dropping the
sentence that named these two recipes as the exceptions to it:

```make
# Every recipe is a single `pnpm exec` call with no shell-specific syntax, so
# it behaves the same whether Make runs it through sh or cmd.exe.
```

Leave the four original targets — `help`, `add-notion-connection`,
`list-notion-connections`, `remove-notion-connection` — and
`reload-community-agent` if the group-personality skill is applied.

Check: `make -n help` still works, and `make -n install-deps` and
`make -n uninstall` both fail with `No rule to make target`.

## 2. Delete the copied files

```bash
rm -f install-dependencies.sh scripts/install-dependencies.test.ts \
      uninstall-dependencies.sh scripts/uninstall-dependencies.test.ts
```

## 3. Revert the installer-shell scan

In `setup/installer-shell.test.ts`, drop the `root` constant and the `.concat`
that adds the repo root, restoring:

```ts
const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => (f.endsWith('.sh') || f.endsWith('.ts')) && !f.endsWith('.test.ts'))
  .map((f) => path.join(here, f))
  .concat(path.resolve(here, '../.claude/skills/add-onecli/scripts/setup.ts'));
```

Leave the `CURL_PIPE` fix in place. It is a correctness fix independent of this
skill: without it a logical OR is read as a pipe, which misreports honest lines
in any file the test scans. Reverting it would reintroduce that bug for
`setup/`'s own installers.

Check: `pnpm exec vitest run setup/installer-shell.test.ts` passes.

## 4. Revert the installer's provenance record

In `install-dependencies.sh`, drop the `T_OWNED` array and its three touch
points — the declaration beside `T_STATE`, the initialiser line in `t_add`,
the `t_own()` function, the `t_own "$key"` call in `run_step`, and the
`"installed_by_this_run"` block in `write_handoff`.

Only the uninstaller reads that key, so removing it with the uninstaller is
correct rather than merely tidy. Nothing else consumes `handoff.json`.

Check: `pnpm exec vitest run scripts/install-dependencies.test.ts` passes, and
`/bin/bash -n install-dependencies.sh` still parses under bash 3.2.

## 5. Verify

```bash
git status
pnpm exec vitest run setup/installer-shell.test.ts
make -n help
```

Nothing from this skill should remain apart from the `CURL_PIPE` fix.
