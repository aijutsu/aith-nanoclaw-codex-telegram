# Remove the dependency installer

Reverses everything apply added. The tools the installer put on the machine are
**not** removed — those are the user's own system state, like the rows a wiring
step creates. Neither is `~/nanoclaw`.

## 1. Remove the make target

Delete the appended block from `Makefile`, all five lines including the second
`.PHONY` declaration and the leading `##` comment:

```make
## Install every prerequisite the course documents — Homebrew, git, jq, Docker,
## Make, Node, pnpm, Codex — then host dependencies and the agent image. Checks
## first and only installs what is missing. The one recipe that is not a
## `pnpm exec` call: it has to run before Node and pnpm exist.
.PHONY: install-deps
install-deps:
	@bash install-dependencies.sh
```

Leave the four original targets — `help`, `add-notion-connection`,
`list-notion-connections`, `remove-notion-connection` — and
`reload-community-agent` if the group-personality skill is applied.

Check: `make -n help` still works and `make -n install-deps` now fails with
`No rule to make target`.

## 2. Delete the copied files

```bash
rm -f install-dependencies.sh scripts/install-dependencies.test.ts
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

## 4. Verify

```bash
git status
pnpm exec vitest run setup/installer-shell.test.ts
make -n help
```

Nothing from this skill should remain apart from the `CURL_PIPE` fix.
