---
name: add-install-dependencies
description: Add `install-dependencies.sh` + `make install-deps` and their mirror `uninstall-dependencies.sh` + `make uninstall` — one idempotent script that checks for and installs every course prerequisite (Homebrew, git, jq, Docker, Make, Node, pnpm, Codex), clones NanoClaw to `~/nanoclaw`, runs host setup and pre-builds the agent image, plus a teardown that asks about each prerequisite separately and only offers what it can prove was installed for NanoClaw. Use when setting up or tearing down a machine, when adding or restoring the cold-start installer or the uninstaller, or after an upstream update drops `install-dependencies.sh`, `uninstall-dependencies.sh`, the `install-deps` or `uninstall` Makefile targets, or the root-level scan in `setup/installer-shell.test.ts`.
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

### 1. Copy the two scripts and their tests

```nc:copy
files/install-dependencies.sh -> install-dependencies.sh
files/install-dependencies.test.ts -> scripts/install-dependencies.test.ts
files/uninstall-dependencies.sh -> uninstall-dependencies.sh
files/uninstall-dependencies.test.ts -> scripts/uninstall-dependencies.test.ts
```

### 2. Add the make targets

Append to `Makefile`. The existing targets are not touched, and each recipe
line is indented with a **tab** — a space-indented recipe makes `make` fail
with `missing separator`. GNU Make accumulates `.PHONY` declarations, so extra
ones are correct rather than editing the existing line:

```nc:append to:Makefile
.PHONY: install-deps
install-deps:
	@bash install-dependencies.sh
```

```nc:append to:Makefile
.PHONY: uninstall
uninstall:
	@bash uninstall-dependencies.sh
```

These are the only recipes in the file that are not `pnpm exec` calls, and for
symmetrical reasons: `install-deps` has to run before Node and pnpm exist, and
`uninstall` has to keep running after it has removed them. Amend the file
header's note about every recipe being a single `pnpm exec` call to name both
exceptions.

### 3. Make both scripts executable

```nc:run
chmod +x install-dependencies.sh uninstall-dependencies.sh
```

### 4. Check them

```nc:run effect:test
pnpm exec vitest run scripts/install-dependencies.test.ts scripts/uninstall-dependencies.test.ts
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

To take it all back off later:
    make uninstall

That hands NanoClaw to its own uninstaller, then asks about each course
prerequisite separately. It only offers what it can prove was installed for
NanoClaw — a git or Node that predates it is reported and left alone. See
what it would touch without changing anything:
    bash uninstall-dependencies.sh --check
```

## How the uninstaller runs

```
0  environment   platform, WSL, package manager
1  provenance    read handoff.json + classify every tool  — nothing removed yet
2  decide        a separate y/N per removable item         — nothing removed yet
3  delegate      nanoclaw.sh --uninstall, or "already removed"
4  remove        the confirmed items, reverse install order
5  profile       drop the marked brew shellenv block
6  homebrew      typed confirmation, last
7  report        what went, what stayed, the final rm to run by hand
```

| Flag | Effect |
| --- | --- |
| `--check` | Classify and report only. Asks nothing, removes nothing. |
| `--dry-run` | Print every command the run would execute, assuming yes to each. |
| `-y`, `--yes` | Take every prerequisite offered. Does **not** answer Homebrew. |
| `--keep-nanoclaw` | Leave NanoClaw alone; consider only the prerequisites. |
| `--dir <path>` | The checkout to remove. Default: this one, else `~/nanoclaw`. |

Exit codes: `0` done · `1` a removal failed · `2` unsupported environment ·
`3` something left for the human · `4` declined, or no terminal.

**Provenance is the whole problem.** `run_step` records a freshly installed
tool as state `present` — the same value as "was already here" — so the state
alone cannot answer "did I install this?". A tool is therefore only ever
offered on positive proof, and anything else is reported under *Leaving alone*
with the reason:

| Tool | Offered only when |
| --- | --- |
| `codex` | Homebrew owns the cask, or `~/.local/bin/codex` exists (the curl fallback's path). Both ⇒ two separate rows, because `PATH` shows only one. |
| `pnpm` | the shim is in Homebrew's or npm's prefix **and** Node is not under a version manager — `npm config get prefix` reports the active Node's prefix, which is inside nvm when Node comes from nvm. |
| `node` | Homebrew owns `node@24` and `node` is not under nvm/fnm/asdf/volta. |
| `docker` | Homebrew owns the `orbstack` or `docker-desktop` cask. Linux engine packages are never attributable, so never offered. |
| `jq`, `git` | Homebrew owns the formula. |
| `make` | **never.** It arrives with Command Line Tools or build-essential and the whole toolchain compiles against it. |
| profile line | the file carries the literal `# Added by NanoClaw install-dependencies.sh` marker, so a brew line the user wrote themselves is untouched. |

`install-dependencies.sh` also publishes an `installed_by_this_run` list in
`logs/install-deps/handoff.json`, which the uninstaller uses as a **demoter
only**: a record that does not name a brew-owned tool means it predates
NanoClaw and is not offered. Promoting on it would be unsafe — a record saying
"we installed node" says nothing about the nvm Node answering `node` today.

Two orderings are load-bearing. Provenance is read **before** the NanoClaw
uninstall, because that deletes `logs/`, where the record lives. And every
decision is taken **before** anything is removed, which is the property
`setup/uninstall/plan.ts` already guarantees for its own half: Ctrl-C during
the questions leaves the machine untouched.

NanoClaw itself is not reimplemented — `nanoclaw.sh --uninstall` already
removes the service, data, secrets, groups, containers, image and runtime
tail with its own four confirmations. This delegates to it and then covers
what its own removal notes declare out of scope: the host prerequisites.

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

- **`Makefile` — the `install-deps` and `uninstall` targets.** Guarded by
  `make -n` in the tests, which also catches a space-indented recipe. Every
  pre-existing target is asserted to still resolve. Neither target shows up in
  `make help`, and that is upstream's shape rather than an oversight: `help` is
  a recipe that runs `scripts/notion-connection.ts help`, not a scan of the
  file's `##` comments, so nothing appended can appear in it. The `##` comments
  are there for whoever reads the `Makefile`.
- **`handoff.json` — the `installed_by_this_run` key.** Written by the
  installer's `T_OWNED` array, read by the uninstaller as a demoter. Additive:
  nothing else consumes that file, and `migrate-v2.sh` has its own separate
  handoff read by `/migrate-from-v1`.
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

### Uninstalling

**`make uninstall` offers almost nothing.** That is usually correct, not a
bug — run `bash uninstall-dependencies.sh --check` and read the *Leaving
alone* column. On a machine where Node came from nvm and git and jq came with
the system, only Docker and Codex were ever NanoClaw's to install, so two or
three rows is the honest answer. Each row states its own reason.

**It will not offer to remove Node or git.** It offers nothing it cannot
prove: Homebrew owning the formula or cask, or the Codex binary sitting in the
path the course's curl fallback installs to. A Node under a version manager
and a `/usr/bin/git` fail that test, because removing them would break
unrelated work. `make` is refused unconditionally — the whole toolchain
compiles against Command Line Tools.

**`--yes` did not remove Homebrew.** By design. `--yes` exists to skip the
small per-item confirmations; Homebrew is asked separately and only accepts
its own name typed in full, because removing it takes every unrelated package
it manages with it. The prompt prints that count first, and says whether the
installer put Homebrew there or found it already present — the shell-profile
marker is the only provenance Homebrew has.

**`codex` is gone but `~/.codex` is still there.** Intended. The removal takes
the binary and the payload under `~/.codex/packages/standalone`, never
`~/.codex` itself, which holds the ChatGPT sign-in and config the installer
never created. The closing report says so and gives the command if you want it
gone too.

**NanoClaw says "already removed" when things are clearly still there.** The
check mirrors `setup/uninstall/scan.ts` — service, `data/`, `logs/`,
`groups/`, `.env`, `node_modules/`, `dist/`, the image, the `ncl` symlink,
labelled containers. If all of those are absent but something remains, it
belongs to a *different* checkout: slugs are per-path, so another copy's
service and image are deliberately none of this script's business.

**An orphaned `docker events` process survives the teardown.** A container
watcher whose host died gets reparented to PID 1 and keeps running.
`uninstall-dependencies.sh` sweeps the ones labelled with **this** install's
slug; `setup/uninstall/` itself scans containers and paths but not watcher
processes, so a vanished checkout's orphan needs
`pkill -f 'nanoclaw-install='` or a targeted `kill`.

**Nothing works after a teardown.** Expected — `node_modules/` is part of the
runtime tail, and every other `make` recipe is a `pnpm exec` call.
`pnpm install --frozen-lockfile` restores enough to run the tests;
`bash nanoclaw.sh` puts the install back.

## How this is verified

Two suites, 96 assertions, both running on `ubuntu-latest` in CI:

| Suite | What it proves |
| --- | --- |
| `scripts/install-dependencies.test.ts` | `make -n install-deps` resolves to the script — which is also what catches a space-indented recipe — and every pre-existing target still resolves. Each course command is present as a literal string and each forbidden one absent. The bash-3.2 and `/dev/tty` constraints hold. Both payload copies are byte-identical to the installed ones. |
| `scripts/uninstall-dependencies.test.ts` | The classifier, driven hermetically: a fake `HOME`, a fake `PATH` and a stub `brew` whose answers come from env vars, so the same expectations hold on a laptop that has Homebrew and in a CI container that does not. Every safety invariant is its own named test — never claiming `make`, refusing a version-managed Node, the record demoting but never promoting, the typed Homebrew gate, all decisions taken before any removal. |

Both suites assert against the script with comment lines stripped. Without
that, a comment explaining which command the script must never use would
satisfy the check that it never uses it, and a commented-out command would pass
a fidelity check — the test would be measuring prose.

Run by hand, and worth re-running after any change to the install path:

- **macOS with everything already present.** `--check` reports all eight tools
  with their versions, installs nothing, exits 0.
- **A bare `ubuntu:24.04` container**, as a non-root user with passwordless
  sudo. All eight detected missing with the right apt commands (exit 5); a real
  install of git, jq and make succeeded and verified each version (exit 0); the
  re-run was a clean no-op; running as root refused with exit 2 and the
  create-a-user runbook; no terminal and no `--yes` exited 4 having installed
  nothing.
- **The `curl | bash` shape**, piped through stdin so `BASH_SOURCE[0]` is not a
  file. That is what makes the script fall through to the clone path instead of
  deciding it is already in a checkout.
- **WSL**, through the three detection seams: WSL 1 exits 2 printing
  `wsl --set-version Ubuntu 2`; WSL 2 proceeds and makes Docker a manual step
  instead of installing Docker Engine inside Ubuntu.
- **The uninstaller's classifier against a real machine**, with
  `uninstall-dependencies.sh --check` on a macOS box whose layout happens to
  exercise most of the table above at once: a Homebrew Codex cask *and* a
  `~/.local/bin/codex` from the curl fallback, Node and pnpm under nvm,
  `/usr/bin/git` and `/usr/bin/jq` from the system, OrbStack from Homebrew.
  It claimed the two Codex copies as separate rows and OrbStack, and left the
  other five alone, each with its own reason. 3 removable, 5 left alone,
  nothing changed.

### What is not verified

Four gaps, named rather than papered over:

- **`shellcheck` has never run** against either script. It is not a dependency
  of this repo and there is no shell-lint job in CI, so treat a manual
  `shellcheck -s bash` as a pre-merge step.
- **Real WSL** needs a Windows 11 host. The seams prove the branching, but
  Docker Desktop's installer and its WSL-integration toggle are GUI and cannot
  be driven from here.
- **A from-zero macOS install** cannot be run on a machine that already has the
  tools. What is exercised on macOS is detection and `--check`.
- **The uninstaller's live removal path.** Every test, and the real-machine run
  above, drives `--check` or `--dry-run` — a test that really removed Homebrew
  would take the maintainer's machine with it. So the classifier is proven on
  real metal and each `brew uninstall` line is asserted as a string, but the
  removals themselves have not been executed. The one exception is what this
  script delegates: `nanoclaw.sh --uninstall` has been run for real on this
  checkout, just not through `make uninstall`. The first full teardown should
  be on a machine nobody minds losing.

## Removal

See [REMOVE.md](REMOVE.md).
