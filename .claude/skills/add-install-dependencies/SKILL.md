---
name: add-install-dependencies
description: Add `install-dependencies.sh` and a `make install-deps` target — one idempotent script that checks for and installs every course prerequisite (Homebrew, git, jq, Docker, Make, Node, pnpm, Codex), clones NanoClaw to `~/nanoclaw`, runs host setup and pre-builds the agent image, so a student runs one command instead of twenty. Use when setting up a machine from scratch, when adding or restoring the cold-start installer, or after an upstream update drops `install-dependencies.sh`, the `install-deps` Makefile target, or the root-level scan in `setup/installer-shell.test.ts`.
---

# Add the dependency installer

The course installs prerequisites across nine pages — Homebrew, Git, jq, Docker,
Make, Node, pnpm, Codex, each with a section per platform. Done by hand that is
about twenty commands in three platform dialects before a student reaches the
first `nanoclaw.sh` run, and every one of them is a place to mistype something.

This installs the executable twin of those pages: one script that runs the same
commands in the same order, checks before it installs anything, and stops where
the human decisions start.

It reaches the machine two ways, and both run the same file:

- **Cold start**, before anything is cloned — a `curl` one-liner.
- **Inside a checkout** — `make install-deps`.

`make` cannot be the cold-start path, because installing Make is itself one of
the course's pages: on macOS `/usr/bin/make` is a Command Line Tools shim that
opens a GUI installer, and a fresh Ubuntu has no `make` until
`build-essential` arrives. So the script installs `make`, and the target is for
re-running later.

**Not installed, deliberately.** Bun is pinned in `container/Dockerfile` and
lives inside the agent image, where `setup/container.ts` verifies it — on the
host it would be dead weight. Claude Code is optional in the course; Codex is
the agent provider.

## Apply

### 1. Copy the installer and its test

```nc:copy
files/install-dependencies.sh -> install-dependencies.sh
files/install-dependencies.test.ts -> scripts/install-dependencies.test.ts
```

### 2. Add the make target

Append to `Makefile`. The four existing targets are not touched, and the
recipe line is indented with a **tab** — a space-indented recipe makes `make`
fail with `missing separator`. GNU Make accumulates `.PHONY` declarations, so a
second one is correct rather than editing the existing line:

```nc:append to:Makefile
.PHONY: install-deps
install-deps:
	@bash install-dependencies.sh
```

This is the only recipe in the file that is not a `pnpm exec` call, because it
has to run before Node and pnpm exist. The file header's note about every
recipe being a single `pnpm exec` call carries that exception.

### 3. Make the installer executable

```nc:run
chmod +x install-dependencies.sh
```

### 4. Check it

```nc:run effect:test
pnpm exec vitest run scripts/install-dependencies.test.ts
```

## Widen the shared installer-shell check

`setup/installer-shell.test.ts` enforces that a downloaded installer is piped
into `/bin/sh` or `/bin/bash` by absolute path, never a shell resolved through
`PATH`. Its file list is built from `readdirSync(here)`, so it only ever saw
`setup/` — every root-level installer, this one included, was outside it.

Widen the list to the repo root, and fix the pattern that decides what counts
as a pipe:

```ts
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const files = readdirSync(here)
  .filter((f) => (f.endsWith('.sh') || f.endsWith('.ts')) && !f.endsWith('.test.ts'))
  .map((f) => path.join(here, f))
  .concat(
    readdirSync(root)
      .filter((f) => f.endsWith('.sh'))
      .map((f) => path.join(root, f)),
  )
  .concat(path.resolve(here, '../.claude/skills/add-onecli/scripts/setup.ts'));
```

`CURL_PIPE` read `|` greedily, so a logical OR looked like a pipe. Require that
the `|` is not followed by another:

```ts
const CURL_PIPE = /curl\b[^|\n]*\|(?!\|)\s*(.+)$/;
```

Without that, three honest lines are reported as violations: `sudo apt install
-y build-essential procps curl file git || return 1` names curl as a *package*
and pipes nothing, `"$(curl …)" || return 1` is a command substitution, and
`curl … -o "$tmp/get-docker.sh" || { … }` is a download to a file. A real
`curl … | sh` is still caught.

## How the installer runs

```
0  environment   platform, WSL version, root, package manager
1  detect        every tool, no changes made
2  confirm       one question (macOS runtime), then one y/N
3  install       course order, only what is missing
4  checkout      reuse the current one, or clone to ~/nanoclaw
5  host deps     setup.sh — Node, pnpm, node_modules, native modules
6  image         pre-build the agent image, skippable
7  next steps    what is left for the human
```

| Flag | Effect |
| --- | --- |
| `-y`, `--yes` | Skip the confirmation. Required when there is no terminal. |
| `--check` | Report only; install nothing. |
| `--docker <runtime>` | `orbstack` (default) or `docker-desktop`, pre-answering the one question. |
| `--dir <path>` | Clone target. Default `~/nanoclaw`. |
| `--skip-clone`, `--skip-build` | Stop after prerequisites; skip the image. |

Exit codes: `0` ready · `1` an install failed · `2` unsupported environment
(WSL 1, no apt or dnf, root on Linux) · `3` something is left for the human ·
`4` declined, or no terminal and no `--yes` · `5` `--check` found gaps.

Nothing already installed is ever reinstalled — it is reported with its version
and skipped. Re-running the script changes nothing.

```nc:operator
Install the prerequisites one of two ways.

Nothing cloned yet:
    curl -fsSL https://raw.githubusercontent.com/aijutsu/aith-nanoclaw-codex-telegram/main/install-dependencies.sh | /bin/bash

Already inside the checkout:
    make install-deps

It lists what is already installed, shows what it will install, and asks once.
On macOS it also asks whether to use OrbStack or Docker Desktop — unless one of
them is already installed, in which case it uses that one and installs neither.

When it finishes, sign Codex in and run setup:
    codex
    bash nanoclaw.sh --agent-provider codex
```

## Keeping it in step with the course

Every install command in the script is quoted from the course, one page per
tool, and `scripts/install-dependencies.test.ts` asserts each one as a literal
string. Changing a command in the script without changing the page it came from
turns that test red. The reverse — editing a page — cannot be caught from this
repo, because the course lives in another one, so a page edit has to be carried
over by hand.

Two commands differ from the page on purpose, both to satisfy the absolute-shell
rule above: the Codex fallback pipes to `/bin/sh` where the page writes `sh`,
and `get-docker.sh` is downloaded into a private temp directory rather than the
working directory, which on a cold start is the user's home.

The test also asserts the commands the script must **never** use:
`brew install make` (it provides `gmake` and leaves `make` alone),
`brew install --cask docker` (renamed upstream to `docker-desktop`; the stale
name still sits in `setup/install-docker.sh`), and `apt install nodejs` (too old
on supported Ubuntu releases).

## Integration points

- **`Makefile` — the `install-deps` target.** Guarded by `make -n install-deps`
  in the test, which also catches a space-indented recipe. The four existing
  targets are asserted to still resolve.
- **`setup/installer-shell.test.ts` — the widened scan.** The same rule is
  asserted independently inside `scripts/install-dependencies.test.ts`, over
  both the repo root and this skill's `files/`, so the fork stays covered even
  if an upstream merge reverts that file.
- **`setup.sh`** is called, not reimplemented: the script passes
  `NANOCLAW_BOOTSTRAP_LOG`, reads the `=== NANOCLAW SETUP: BOOTSTRAP ===` block
  for `STATUS`, `NODE_VERSION` and `NATIVE_OK`, and honours its exit codes,
  the same way `nanoclaw.sh` and `migrate-v2.sh` do.
- **`container/build.sh`** is called for the pre-build and may be skipped; the
  image is built by setup regardless, so a skip only costs time.

## Troubleshooting

**`brew: command not found` right after it installed Homebrew.** Homebrew is
only on `PATH` once its `shellenv` line runs. The script does that for its own
process and appends it to the right profile file, but an already-open terminal
will not have it. Open a new terminal.

**Node stays on an old version.** If `node` comes from nvm, fnm, asdf or volta,
the script will not link a Homebrew Node over it — `PATH` precedence means the
next terminal would still get the old one. It reports the version manager's own
upgrade command instead; run that.

**It stops and asks you to finish the Command Line Tools install.** On macOS
`make` arrives with Command Line Tools, whose installer is a GUI window.
`better-sqlite3` compiles against it, so continuing while that is still running
produces a native build failure that looks like a NanoClaw bug. Let it finish,
then run the script again.

**It will not install Docker on Windows.** Docker Desktop is a Windows
application and has to be installed on the Windows side; installing Docker
Engine inside Ubuntu instead is the wrong outcome. The script detects whether
Docker Desktop is already installed and either points at the download or tells
you to turn on WSL integration for Ubuntu.

**`No terminal to ask on`, exit 4.** Something was missing and there was no
`/dev/tty` to confirm on. Re-run with `--yes`.

## Removal

See [REMOVE.md](REMOVE.md).
