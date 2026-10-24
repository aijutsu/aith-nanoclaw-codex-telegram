#!/usr/bin/env bash
#
# uninstall-dependencies.sh — the mirror of install-dependencies.sh.
#
#   make uninstall
#   bash uninstall-dependencies.sh [options]
#
# Where the installer asks one question and then installs everything missing,
# this asks about every item separately, because removal is not symmetric with
# installation: the installer knows it is adding something, while a remover has
# to work out whether the thing in front of it is even ours.
#
# PROVENANCE IS THE WHOLE PROBLEM. `run_step` in install-dependencies.sh
# records a freshly installed tool as state `present` — the same value it uses
# for "was already here" — so even its own handoff.json cannot answer "did I
# install this?". Everything below reconstructs that answer, and refuses to
# guess:
#
#   ours      positive proof this install put it here. Offered, default No.
#   foreign   present, but the proof points elsewhere. Reported, never offered.
#   absent    not installed.
#
# A tool is only ever `ours` on positive evidence — Homebrew owning the
# formula or cask, or a binary sitting in the path the course's curl fallback
# installs to. `make` is never `ours` under any circumstances: it arrives with
# Xcode Command Line Tools or build-essential and the whole toolchain shares
# it. A Node under nvm/fnm/asdf/volta is never ours either, however much it
# looks like the one the course installs.
#
# Linux apt/dnf packages are never attributable — nothing records which
# packages predated the course — so on Linux only linuxbrew-owned tools, the
# `~/.local/bin/codex` fallback and the profile marker are ever offered. That
# is also why this script never needs sudo.
#
# WHY BASH. It removes Node and pnpm, so it cannot be TypeScript:
# setup/uninstall/flow.ts documents the contortions its own self-deletion
# constraint forces ("runs on tsx out of the node_modules it deletes"). A bash
# twin of the installer has no such problem, and after a NanoClaw uninstall it
# is the only `make` recipe in the repo that still runs at all — every other
# one is a `pnpm exec` call into a node_modules that is gone.
#
# ORDER IS LOAD-BEARING, in two places:
#
#   Provenance is read BEFORE the NanoClaw uninstall, because that uninstall
#   deletes logs/, where logs/install-deps/handoff.json lives.
#
#   Every decision is taken BEFORE anything is removed, which is the property
#   setup/uninstall/plan.ts already guarantees for its own phase: Ctrl-C
#   during the questions leaves the machine exactly as it was.
#
# NanoClaw itself is not reimplemented here. `nanoclaw.sh --uninstall` ->
# setup/uninstall/ already removes the service, data, secrets, groups,
# containers, image, the ncl symlink and the runtime tail, with its own four
# confirmations. This delegates to it and then covers what its REMOVE.md
# declares out of scope: the host prerequisites.
#
# `set -e` is deliberately absent, as in install-dependencies.sh and
# migrate-v2.sh: every step records its own status so one failed `brew
# uninstall` cannot abort the rest of the run.
set -uo pipefail

VERSION="1.0.0"

# ─── options ─────────────────────────────────────────────────────────────────

OPT_YES=false
OPT_CHECK=false
OPT_DRY=false
OPT_KEEP_NANOCLAW=false
OPT_DIR=""

usage() {
  cat <<'USAGE'
Usage: uninstall-dependencies.sh [options]

Removes this NanoClaw copy and, one at a time, the course prerequisites it can
prove were installed for it — Homebrew packages, the Codex binary, the brew
line added to your shell profile. Anything whose origin points elsewhere is
reported and left alone.

NanoClaw itself is handed to `nanoclaw.sh --uninstall`, which asks its own
questions about the service, your data and your agents' files.

Options:
  -y, --yes             Take every prerequisite offered, without asking.
                        Homebrew still requires its typed confirmation.
      --check           Classify and report only. Asks nothing, removes
                        nothing. The best way to see what this would touch.
      --dry-run         Print every command the run would execute, assuming
                        yes to each item. Asks nothing, removes nothing.
      --keep-nanoclaw   Leave NanoClaw alone; only consider the prerequisites.
      --dir <path>      The NanoClaw checkout to remove. Default: the one this
                        script lives in, else ~/nanoclaw.
  -h, --help            Show this and exit.

Exit codes:
  0  done            1  a removal failed      2  unsupported environment
  3  manual action required                   4  declined / no terminal
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)         OPT_YES=true; shift ;;
    --check)          OPT_CHECK=true; shift ;;
    --dry-run)        OPT_DRY=true; shift ;;
    --keep-nanoclaw)  OPT_KEEP_NANOCLAW=true; shift ;;
    --dir)            OPT_DIR="${2:-}"; shift 2 ;;
    --dir=*)          OPT_DIR="${1#*=}"; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)                printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

# ─── output ──────────────────────────────────────────────────────────────────
#
# Inlined rather than sourced, for the same reason install-dependencies.sh
# inlines it: this script has to keep working when the checkout around it is
# being dismantled. Near-twins live in install-dependencies.sh, nanoclaw.sh
# and migrate-v2.sh; if you change the look, change all four.

USE_ANSI=false
if [ -t 1 ] && [ "${TERM:-dumb}" != "dumb" ] && [ -z "${NO_COLOR:-}" ]; then
  USE_ANSI=true
fi

if $USE_ANSI; then
  dim()   { printf '\033[2m%s\033[0m' "$1"; }
  green() { printf '\033[32m%s\033[0m' "$1"; }
  red()   { printf '\033[31m%s\033[0m' "$1"; }
  yellow(){ printf '\033[33m%s\033[0m' "$1"; }
  bold()  { printf '\033[1m%s\033[0m' "$1"; }
else
  dim()   { printf '%s' "$1"; }
  green() { printf '%s' "$1"; }
  red()   { printf '%s' "$1"; }
  yellow(){ printf '%s' "$1"; }
  bold()  { printf '%s' "$1"; }
fi

say()         { printf '%s\n' "$*"; }
blank()       { printf '\n'; }
step_ok()     { printf '  %s %s\n' "$(green '✓')" "$*"; }
step_fail()   { printf '  %s %s\n' "$(red '✗')" "$*"; }
step_skip()   { printf '  %s %s\n' "$(dim '–')" "$*"; }
step_manual() { printf '  %s %s\n' "$(yellow '!')" "$*"; }
step_info()   { printf '  %s %s\n' "$(dim '·')" "$*"; }
heading()     { blank; printf '%s\n' "$(bold "$*")"; }

# ─── logging ─────────────────────────────────────────────────────────────────

LOG_DIR="${TMPDIR:-/tmp}"
LOG="${LOG_DIR%/}/nanoclaw-uninstall-deps.$$.log"
: > "$LOG" 2>/dev/null || LOG=/dev/null
log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG" 2>/dev/null || true; }
log "uninstall-dependencies.sh $VERSION starting"

# ─── item registry ───────────────────────────────────────────────────────────
#
# Parallel indexed arrays, not one associative array: /bin/bash on macOS is
# 3.2, which has no `declare -A`. Same approach as install-dependencies.sh and
# migrate-v2.sh.
#
# One row per removable thing, which is not one row per tool — Codex can be
# installed twice over (a Homebrew cask and the curl fallback's binary), and
# each copy is its own decision.

T_KEY=()     # stable id
T_LABEL=()   # what the user sees
T_STATE=()   # ours | foreign | absent
T_DETAIL=()  # version or path, shown beside the label
T_REASON=()  # why it is foreign; empty when ours
T_CMD=()     # the removal command, run by phase 4 and printed by --dry-run
T_SEL=()     # y | n, filled in phase 2

t_add() {
  T_KEY[${#T_KEY[@]}]="$1"
  T_LABEL[${#T_LABEL[@]}]="$2"
  T_STATE[${#T_STATE[@]}]="$3"
  T_DETAIL[${#T_DETAIL[@]}]="$4"
  T_REASON[${#T_REASON[@]}]="$5"
  T_CMD[${#T_CMD[@]}]="$6"
  T_SEL[${#T_SEL[@]}]="n"
  log "classify $1: $3 ${4:-} ${5:+— $5}"
}

t_count_state() {
  local want="$1" i=0 n=0
  while [ "$i" -lt "${#T_KEY[@]}" ]; do
    if [ "${T_STATE[$i]}" = "$want" ]; then n=$((n + 1)); fi
    i=$((i + 1))
  done
  printf '%s' "$n"
}

t_count_selected() {
  local i=0 n=0
  while [ "$i" -lt "${#T_KEY[@]}" ]; do
    if [ "${T_SEL[$i]}" = "y" ]; then n=$((n + 1)); fi
    i=$((i + 1))
  done
  printf '%s' "$n"
}

MANUAL=()
manual_add() {
  MANUAL[${#MANUAL[@]}]="$1"
  log "manual action: $1"
}

FAILED=false
REMOVED=0
# Set when a Codex removal leaves ~/.codex (sign-in + config) in place, so the
# closing report can say so rather than let the user assume it is all gone.
CODEX_CONFIG_KEPT=false
# True when a shell profile carries the installer's marker. persist_brew_shellenv
# is reached from exactly one place — inside install_brew — while probe_brew only
# ever calls load_brew_env, which fixes PATH for one process and writes nothing.
# So the marker is proof that THIS installer installed Homebrew, and its absence
# is proof that Homebrew was already here. The only provenance Homebrew has.
BREW_FROM_INSTALLER=false

# ─── small helpers ───────────────────────────────────────────────────────────

have() { command -v "$1" >/dev/null 2>&1; }

first_line() { head -n 1 2>/dev/null; }

# Interactivity is "can I read an answer", which is /dev/tty — never stdin.
# install-dependencies.sh explains why at length: under `curl | bash` stdin IS
# the script, so a `! [ -t 0 ]` gate would reject a legitimate run. The
# redirect probe also catches a /dev/tty that exists while the process has no
# controlling terminal.
HAS_TTY=false
if [ -r /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then HAS_TTY=true; fi

ask() {
  local prompt="$1" default="$2" reply=""
  if ! $HAS_TTY; then printf '%s' "$default"; return 0; fi
  printf '%s' "$prompt" > /dev/tty
  read -r reply < /dev/tty || reply=""
  if [ -z "$reply" ]; then reply="$default"; fi
  printf '%s' "$reply"
}

confirm() {
  local reply
  reply=$(ask "$1" "n")
  case "$reply" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

# A y/N is too cheap for a decision that takes unrelated software with it, so
# Homebrew asks for its own name instead. Deliberately not satisfied by --yes.
confirm_word() {
  local prompt="$1" want="$2" reply
  reply=$(ask "$prompt" "")
  [ "$(printf '%s' "$reply" | tr 'A-Z' 'a-z')" = "$want" ]
}

# ─── environment ─────────────────────────────────────────────────────────────

PLATFORM="unknown"
IS_WSL=false

# Test seams, matching install-dependencies.sh so the same fixtures drive both.
UNAME_S="${NANOCLAW_UNAME_S:-$(uname -s)}"

case "$UNAME_S" in
  Darwin*) PLATFORM="macos" ;;
  Linux*)  PLATFORM="linux" ;;
  *)       PLATFORM="unknown" ;;
esac
if [ "$PLATFORM" = "linux" ] && grep -qi 'microsoft\|wsl' /proc/version 2>/dev/null; then
  IS_WSL=true
fi

if [ "$PLATFORM" = "unknown" ]; then
  blank
  say "$(red 'Unsupported system:') $UNAME_S"
  say "This script runs on macOS and Linux."
  exit 2
fi
log "platform=$PLATFORM is_wsl=$IS_WSL"

# ─── the checkout ────────────────────────────────────────────────────────────

script_dir() {
  local s="${BASH_SOURCE[0]:-}"
  [ -n "$s" ] || return 1
  [ -f "$s" ] || return 1
  (cd "$(dirname "$s")" 2>/dev/null && pwd) || return 1
}

is_nanoclaw_checkout() {
  [ -n "$1" ] || return 1
  [ -f "$1/nanoclaw.sh" ] && [ -f "$1/package.json" ]
}

PROJECT_ROOT=""
if [ -n "$OPT_DIR" ]; then
  PROJECT_ROOT="$(cd "$OPT_DIR" 2>/dev/null && pwd)" || PROJECT_ROOT="$OPT_DIR"
else
  PROJECT_ROOT="$(script_dir)" || PROJECT_ROOT=""
  if ! is_nanoclaw_checkout "$PROJECT_ROOT"; then
    if is_nanoclaw_checkout "$HOME/nanoclaw"; then PROJECT_ROOT="$HOME/nanoclaw"; fi
  fi
fi

# Slug is sha1(PROJECT_ROOT)[:8]. Sourced from the tracked helper so this can
# never disagree with the names setup chose; recomputed inline only if the
# checkout is too far gone to provide it.
INSTALL_SLUG=""
if [ -n "$PROJECT_ROOT" ] && [ -f "$PROJECT_ROOT/setup/lib/install-slug.sh" ]; then
  NANOCLAW_PROJECT_ROOT="$PROJECT_ROOT"
  export NANOCLAW_PROJECT_ROOT
  # shellcheck source=setup/lib/install-slug.sh
  . "$PROJECT_ROOT/setup/lib/install-slug.sh" 2>/dev/null || true
  INSTALL_SLUG="$(_nanoclaw_install_slug 2>/dev/null)" || INSTALL_SLUG=""
fi
if [ -z "$INSTALL_SLUG" ] && [ -n "$PROJECT_ROOT" ]; then
  if have shasum; then
    INSTALL_SLUG="$(printf '%s' "$PROJECT_ROOT" | shasum | cut -c 1-8)"
  elif have sha1sum; then
    INSTALL_SLUG="$(printf '%s' "$PROJECT_ROOT" | sha1sum | cut -c 1-8)"
  fi
fi
RUNTIME="${CONTAINER_RUNTIME:-docker}"
log "project_root=${PROJECT_ROOT:-none} slug=${INSTALL_SLUG:-none} runtime=$RUNTIME"

# ─── homebrew ────────────────────────────────────────────────────────────────

brew_candidates() {
  printf '%s\n' /opt/homebrew/bin/brew /usr/local/bin/brew \
    /home/linuxbrew/.linuxbrew/bin/brew "$HOME/.linuxbrew/bin/brew"
}

# Put brew on PATH for THIS process, exactly as the installer does — a login
# shell that never ran `shellenv` would otherwise hide every brew-owned tool
# and this script would report them all as absent.
load_brew_env() {
  if have brew; then return 0; fi
  local c
  for c in $(brew_candidates); do
    if [ -x "$c" ]; then
      eval "$("$c" shellenv)" 2>/dev/null || true
      hash -r 2>/dev/null || true
      if have brew; then log "brew loaded from $c"; return 0; fi
    fi
  done
  return 1
}
load_brew_env || true

BREW_BIN="${NANOCLAW_BREW_BIN:-$(command -v brew 2>/dev/null)}"
brew_owns_formula() {
  [ -n "$BREW_BIN" ] || return 1
  "$BREW_BIN" list --formula --versions "$1" >/dev/null 2>&1
}
brew_owns_cask() {
  [ -n "$BREW_BIN" ] || return 1
  "$BREW_BIN" list --cask --versions "$1" >/dev/null 2>&1
}
brew_version_of() {
  [ -n "$BREW_BIN" ] || return 1
  "$BREW_BIN" list "$2" --versions "$1" 2>/dev/null | first_line | sed "s/^$1 //"
}

# ─── the installer's own record ──────────────────────────────────────────────
#
# install-dependencies.sh writes logs/install-deps/handoff.json on every exit,
# including an "installed_by_this_run" list. That list is used as a DEMOTER
# only, never a promoter: if a record exists and does not name a tool, a
# brew-owned copy of it predates NanoClaw and must not be offered. Promoting
# the other way would be unsafe — a record saying "we installed node" tells
# you nothing about the nvm-managed node that answers `node` today.
#
# Absent record means no demotion, and every prompt still defaults to No.

HANDOFF_FOUND=false
HANDOFF_LIST=""

read_handoff() {
  local f="$PROJECT_ROOT/logs/install-deps/handoff.json"
  [ -f "$f" ] || return 0
  grep -q '"installed_by_this_run"' "$f" 2>/dev/null || return 0
  HANDOFF_FOUND=true
  # The array, flattened to a space-delimited list. sed rather than jq: jq is
  # one of the tools this script can remove, so it cannot be a dependency.
  HANDOFF_LIST=" $(sed -n '/"installed_by_this_run"/,/]/p' "$f" 2>/dev/null |
    tr -d '\n' | sed -e 's/.*\[//' -e 's/\].*//' -e 's/"//g' -e 's/,/ /g') "
  log "handoff names:$HANDOFF_LIST"
}

# true when a record exists and does NOT name this tool.
handoff_denies() {
  $HANDOFF_FOUND || return 1
  case "$HANDOFF_LIST" in *" $1 "*) return 1 ;; *) return 0 ;; esac
}

# ─── classification ──────────────────────────────────────────────────────────
#
# One per removable thing. Each decides ours | foreign | absent and, when
# foreign, states why in the words the report prints.

node_manager() {
  local p; p="$(command -v node 2>/dev/null)" || return 1
  case "$p" in
    "$HOME"/.nvm/*)   printf '%s' 'nvm' ; return 0 ;;
    "$HOME"/.fnm/*)   printf '%s' 'fnm' ; return 0 ;;
    "$HOME"/.asdf/*)  printf '%s' 'asdf'; return 0 ;;
    "$HOME"/.volta/*) printf '%s' 'volta'; return 0 ;;
  esac
  if [ -n "${NVM_DIR:-}" ]; then
    case "$p" in "$NVM_DIR"/*) printf '%s' 'nvm'; return 0 ;; esac
  fi
  printf '%s' ''
  return 1
}

classify_formula() {
  local key="$1" label="$2" formula="$3" path v
  path="$(command -v "$key" 2>/dev/null)"
  if [ -z "$path" ] && ! brew_owns_formula "$formula"; then
    t_add "$key" "$label" absent "" "" ""
    return 0
  fi
  if ! brew_owns_formula "$formula"; then
    t_add "$key" "$label" foreign "$path" "not Homebrew's — came with the system or its package manager" ""
    return 0
  fi
  if handoff_denies "$key"; then
    t_add "$key" "$label" foreign "$path" "Homebrew's, but installed before NanoClaw" ""
    return 0
  fi
  v="$(brew_version_of "$formula" --formula)"
  t_add "$key" "$label" ours "${v:-$path}" "" "$BREW_BIN uninstall --formula $formula"
}

classify_make() {
  # Never ours, on any platform and under any evidence. `make` arrives with
  # Xcode Command Line Tools (which better-sqlite3 and every native module
  # compile against) or with build-essential, and the course deliberately
  # avoids `brew install make` because that provides gmake and leaves `make`
  # alone. There is no version of this that is safe to offer.
  local path; path="$(command -v make 2>/dev/null)"
  if [ -z "$path" ]; then t_add make "Make" absent "" "" ""; return 0; fi
  if [ "$PLATFORM" = "macos" ]; then
    t_add make "Make" foreign "$path" "Xcode Command Line Tools — the whole toolchain compiles against it" ""
  else
    t_add make "Make" foreign "$path" "build-essential — shared with every native build" ""
  fi
}

classify_node() {
  local path mgr v
  path="$(command -v node 2>/dev/null)"
  if [ -z "$path" ] && ! brew_owns_formula node@24; then
    t_add node "Node.js" absent "" "" ""
    return 0
  fi
  mgr="$(node_manager)"
  if [ -n "$mgr" ]; then
    t_add node "Node.js" foreign "$(node --version 2>/dev/null) ($path)" "managed by $mgr, not Homebrew" ""
    return 0
  fi
  if ! brew_owns_formula node@24; then
    t_add node "Node.js" foreign "$path" "not Homebrew's node@24" ""
    return 0
  fi
  if handoff_denies node; then
    t_add node "Node.js" foreign "$path" "Homebrew's, but installed before NanoClaw" ""
    return 0
  fi
  v="$(brew_version_of node@24 --formula)"
  t_add node "Node.js" ours "${v:-$path}" "" "$BREW_BIN uninstall --formula node@24"
}

classify_pnpm() {
  local path prefix brew_prefix npm_prefix mgr
  path="$(command -v pnpm 2>/dev/null)"
  if [ -z "$path" ]; then t_add pnpm "pnpm" absent "" "" ""; return 0; fi

  # `npm config get prefix` reports the ACTIVE Node's prefix, which sits
  # inside the version manager's tree when Node comes from one — so the
  # npm-prefix rule below would otherwise claim an nvm-managed pnpm as ours.
  # It cannot be: the installer only reaches `npm install -g pnpm@10` with a
  # Homebrew or system Node, because faced with a version manager it declines
  # to install Node at all and prints that manager's own upgrade command.
  mgr="$(node_manager)"
  if [ -n "$mgr" ]; then
    t_add pnpm "pnpm" foreign "$path" "under $mgr's Node, which the installer never installs into" ""
    return 0
  fi

  prefix="$(dirname "$path")"
  brew_prefix=""
  [ -n "$BREW_BIN" ] && brew_prefix="$("$BREW_BIN" --prefix 2>/dev/null)"
  npm_prefix="$(npm config get prefix 2>/dev/null)"

  # The installer acquires pnpm two ways: a corepack shim written into
  # brew's bin, or `npm install -g pnpm@10`. Anywhere else — notably a
  # version manager's bin — is somebody else's pnpm.
  if [ -n "$brew_prefix" ] && [ "$prefix" = "$brew_prefix/bin" ]; then
    if handoff_denies pnpm; then
      t_add pnpm "pnpm" foreign "$path" "in Homebrew's bin, but installed before NanoClaw" ""
      return 0
    fi
    t_add pnpm "pnpm" ours "$(pnpm --version 2>/dev/null) ($path)" "" \
      "corepack disable --install-directory $brew_prefix/bin pnpm"
    return 0
  fi
  if [ -n "$npm_prefix" ] && [ "$prefix" = "$npm_prefix/bin" ]; then
    if handoff_denies pnpm; then
      t_add pnpm "pnpm" foreign "$path" "npm-global, but installed before NanoClaw" ""
      return 0
    fi
    t_add pnpm "pnpm" ours "$(pnpm --version 2>/dev/null) ($path)" "" "npm uninstall -g pnpm"
    return 0
  fi
  t_add pnpm "pnpm" foreign "$path" "outside Homebrew's and npm's prefixes" ""
}

classify_docker() {
  local v
  if [ "$PLATFORM" != "macos" ]; then
    # get.docker.com installs distro packages, and nothing records which
    # ones predated the course. Never attributable, so never offered.
    local path; path="$(command -v docker 2>/dev/null)"
    if [ -z "$path" ]; then t_add docker "Docker" absent "" "" ""; return 0; fi
    t_add docker "Docker" foreign "$path" "distro package — removal would not be attributable to NanoClaw" ""
    return 0
  fi
  if brew_owns_cask orbstack; then
    if handoff_denies docker; then
      t_add docker "OrbStack" foreign "cask" "Homebrew's, but installed before NanoClaw" ""
      return 0
    fi
    v="$(brew_version_of orbstack --cask)"
    t_add docker "OrbStack" ours "${v:-cask}" "" "$BREW_BIN uninstall --cask orbstack"
    return 0
  fi
  if brew_owns_cask docker-desktop; then
    if handoff_denies docker; then
      t_add docker "Docker Desktop" foreign "cask" "Homebrew's, but installed before NanoClaw" ""
      return 0
    fi
    v="$(brew_version_of docker-desktop --cask)"
    t_add docker "Docker Desktop" ours "${v:-cask}" "" "$BREW_BIN uninstall --cask docker-desktop"
    return 0
  fi
  local path; path="$(command -v docker 2>/dev/null)"
  if [ -z "$path" ]; then t_add docker "Docker" absent "" "" ""; return 0; fi
  t_add docker "Docker" foreign "$path" "no Homebrew cask owns it" ""
}

# Codex can be present twice over — the cask and the curl fallback's binary —
# and PATH only shows you one of them. Each copy is its own row, so removing
# the one the course installed cannot silently leave the other behind.
classify_codex() {
  local v
  if brew_owns_cask codex; then
    if handoff_denies codex; then
      t_add codex-cask "Codex (Homebrew cask)" foreign "cask" "Homebrew's, but installed before NanoClaw" ""
    else
      v="$(brew_version_of codex --cask)"
      t_add codex-cask "Codex (Homebrew cask)" ours "${v:-cask}" "" "$BREW_BIN uninstall --cask codex"
    fi
  fi
  # The curl installer puts the payload under ~/.codex/packages/standalone and
  # only symlinks ~/.local/bin/codex, so removing the link alone would take
  # `codex` off PATH and leave the whole install on disk. Follow the link and
  # remove what it points into — but never ~/.codex itself, which also holds
  # the ChatGPT sign-in and config. Those are the user's, not the installer's.
  if [ -e "$HOME/.local/bin/codex" ]; then
    local link target cmd
    link="$HOME/.local/bin/codex"
    target="$(readlink "$link" 2>/dev/null)"
    cmd="rm -f '$link'"
    case "$target" in
      "$HOME"/.codex/packages/*)
        cmd="$cmd && rm -rf '$HOME/.codex/packages/standalone'"
        CODEX_CONFIG_KEPT=true
        ;;
    esac
    t_add codex-bin "Codex (~/.local/bin)" ours \
      "$("$link" --version 2>/dev/null | first_line)" "" "$cmd"
  fi
  if ! brew_owns_cask codex && [ ! -f "$HOME/.local/bin/codex" ]; then
    local path; path="$(command -v codex 2>/dev/null)"
    if [ -z "$path" ]; then
      t_add codex "Codex" absent "" "" ""
    else
      t_add codex "Codex" foreign "$path" "not a Homebrew cask or the course's ~/.local/bin install" ""
    fi
  fi
}

# The one exact fingerprint the installer leaves: persist_brew_shellenv writes
# this comment above the line it appends. Matching the marker rather than the
# shellenv line means a profile the user wrote themselves is never touched.
PROFILE_MARKER="# Added by NanoClaw install-dependencies.sh"

profile_candidates() {
  printf '%s\n' "$HOME/.zprofile" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.bashrc"
}

classify_profile() {
  local f found=""
  for f in $(profile_candidates); do
    if [ -f "$f" ] && grep -Fq "$PROFILE_MARKER" "$f" 2>/dev/null; then
      found="$f"
      break
    fi
  done
  if [ -z "$found" ]; then
    t_add profile "Shell profile line" absent "" "" ""
    return 0
  fi
  BREW_FROM_INSTALLER=true
  t_add profile "Shell profile line" ours "$found" "" "PROFILE_EDIT $found"
}

classify_all() {
  T_KEY=(); T_LABEL=(); T_STATE=(); T_DETAIL=(); T_REASON=(); T_CMD=(); T_SEL=()
  read_handoff
  classify_codex
  classify_pnpm
  classify_node
  classify_docker
  classify_formula jq "jq" jq
  classify_formula git "git" git
  classify_make
  classify_profile
}

# ─── NanoClaw's own artifacts ────────────────────────────────────────────────
#
# Only a yes/no: does the existing uninstaller have anything to do? The
# signals mirror setup/uninstall/scan.ts so the two cannot disagree about
# whether an install is still there.

nanoclaw_artifacts_found() {
  [ -n "$PROJECT_ROOT" ] || return 1
  local p
  for p in data logs groups .env node_modules dist; do
    [ -e "$PROJECT_ROOT/$p" ] && return 0
  done
  [ -f "$HOME/Library/LaunchAgents/com.nanoclaw-v2-$INSTALL_SLUG.plist" ] && return 0
  [ -f "$HOME/.config/systemd/user/nanoclaw-v2-$INSTALL_SLUG.service" ] && return 0
  if [ -L "$HOME/.local/bin/ncl" ]; then
    case "$(readlink "$HOME/.local/bin/ncl" 2>/dev/null)" in
      "$PROJECT_ROOT"/*) return 0 ;;
    esac
  fi
  if [ -n "$INSTALL_SLUG" ] && have "$RUNTIME"; then
    "$RUNTIME" image inspect "nanoclaw-agent-v2-$INSTALL_SLUG:latest" >/dev/null 2>&1 && return 0
    [ -n "$("$RUNTIME" ps -aq --filter "label=nanoclaw-install=$INSTALL_SLUG" 2>/dev/null)" ] && return 0
  fi
  return 1
}

# ─── reporting ───────────────────────────────────────────────────────────────

report() {
  local i

  if [ "$(t_count_state ours)" -gt 0 ]; then
    heading "Installed for NanoClaw"
    i=0
    while [ "$i" -lt "${#T_KEY[@]}" ]; do
      if [ "${T_STATE[$i]}" = "ours" ]; then
        printf '  %s %s %s\n' "$(yellow '-')" \
          "$(bold "$(printf '%-22s' "${T_LABEL[$i]}")")" "$(dim "${T_DETAIL[$i]}")"
      fi
      i=$((i + 1))
    done
  fi

  if [ "$(t_count_state foreign)" -gt 0 ]; then
    heading "Leaving alone"
    i=0
    while [ "$i" -lt "${#T_KEY[@]}" ]; do
      if [ "${T_STATE[$i]}" = "foreign" ]; then
        printf '  %s %s %s\n' "$(dim '·')" \
          "$(printf '%-22s' "${T_LABEL[$i]}")" "$(dim "${T_REASON[$i]}")"
      fi
      i=$((i + 1))
    done
  fi

  if $HANDOFF_FOUND; then
    blank
    step_info "$(dim "Using the installer's own record in logs/install-deps/handoff.json")"
  fi
}

# ─── phase 2: decide ─────────────────────────────────────────────────────────
#
# Every question is asked here, before phase 4 removes anything, so a Ctrl-C
# anywhere in this loop leaves the machine untouched. That is the same
# guarantee setup/uninstall/plan.ts gives for its own half.

decide() {
  local i=0
  # Only a heading when there is actually something to answer; --yes and
  # --dry-run select everything without asking.
  if ! $OPT_YES && ! $OPT_DRY; then
    heading "What to remove"
    say "$(dim '  Each is asked separately. Enter keeps it.')"
    blank
  fi
  while [ "$i" -lt "${#T_KEY[@]}" ]; do
    if [ "${T_STATE[$i]}" = "ours" ]; then
      if $OPT_YES || $OPT_DRY; then
        T_SEL[$i]="y"
      elif confirm "  $(printf '%-24s' "${T_LABEL[$i]}") remove? [y/N] "; then
        T_SEL[$i]="y"
      fi
      log "decision ${T_KEY[$i]} = ${T_SEL[$i]}"
    fi
    i=$((i + 1))
  done
}

# ─── phase 3: NanoClaw ───────────────────────────────────────────────────────

delegate_nanoclaw() {
  heading "NanoClaw"

  if $OPT_KEEP_NANOCLAW; then
    step_skip "Keeping NanoClaw (--keep-nanoclaw)"
    return 0
  fi
  if [ -z "$PROJECT_ROOT" ] || ! is_nanoclaw_checkout "$PROJECT_ROOT"; then
    step_skip "No NanoClaw checkout found — nothing to hand over"
    return 0
  fi
  if ! nanoclaw_artifacts_found; then
    step_ok "Already removed $(dim "nothing left in $PROJECT_ROOT")"
    return 0
  fi

  if $OPT_DRY; then
    step_info "would run: bash $PROJECT_ROOT/nanoclaw.sh --uninstall --dry-run"
    return 0
  fi

  # Must happen while Node is still here: nanoclaw.sh gates on node plus
  # node_modules/.bin/tsx and otherwise falls back to printing manual
  # cleanup. Phase 4 is what removes Node, and it runs after this.
  say "$(dim '  Handing over to the NanoClaw uninstaller, which asks its own questions.')"
  blank
  local args=""
  $OPT_YES && args="--yes"
  bash "$PROJECT_ROOT/nanoclaw.sh" --uninstall $args
  local rc=$?
  log "nanoclaw.sh --uninstall rc=$rc"

  # A non-zero exit here is usually the documented degraded path — no
  # node_modules, so it printed manual cleanup guidance and stopped. That has
  # already been shown to the user; do not reprint it, and do not call it a
  # failure of this run.
  if [ "$rc" -ne 0 ]; then
    blank
    step_manual "The NanoClaw uninstaller stopped early (exit $rc) — see its output above"
    manual_add "Finish removing NanoClaw using the guidance the uninstaller printed above."
  fi
  return 0
}

# Orphaned container watchers: a `docker events` subscriber whose host died
# gets reparented to PID 1 and keeps running. Scoped to THIS install's slug —
# another checkout's orphan is not this script's business to kill.
sweep_orphan_watchers() {
  [ -n "$INSTALL_SLUG" ] || return 0
  local pids
  pids="$(pgrep -f "nanoclaw-install=$INSTALL_SLUG" 2>/dev/null)" || return 0
  [ -n "$pids" ] || return 0
  if $OPT_DRY; then
    step_info "would stop orphaned watcher(s): $(printf '%s' "$pids" | tr '\n' ' ')"
    return 0
  fi
  local p
  for p in $pids; do
    kill "$p" 2>/dev/null && log "killed orphan watcher $p"
  done
  step_ok "Stopped orphaned container watcher(s) $(dim "$(printf '%s' "$pids" | tr '\n' ' ')")"
}

# ─── phase 4: remove ─────────────────────────────────────────────────────────

# The single place anything is removed. `set -e` is off, so every status check
# lives here rather than being scattered — which is what makes that safe.
run_removal() {
  local idx="$1" label cmd rc
  label="${T_LABEL[$idx]}"
  cmd="${T_CMD[$idx]}"

  if [ -z "$cmd" ]; then return 0; fi

  if $OPT_DRY; then
    case "$cmd" in
      PROFILE_EDIT*) step_info "would drop the NanoClaw block from ${cmd#PROFILE_EDIT }" ;;
      *)             step_info "would run: $cmd" ;;
    esac
    return 0
  fi

  printf '  %s Removing %s…' "$(dim '·')" "$label"
  case "$cmd" in
    PROFILE_EDIT*) edit_profile "${cmd#PROFILE_EDIT }" >> "$LOG" 2>&1; rc=$? ;;
    *)             sh -c "$cmd" >> "$LOG" 2>&1; rc=$? ;;
  esac
  if $USE_ANSI; then printf '\r\033[K'; else printf '\n'; fi

  if [ "$rc" -ne 0 ]; then
    step_fail "$label — removal failed, see $LOG"
    FAILED=true
    return 1
  fi
  step_ok "$label removed"
  REMOVED=$((REMOVED + 1))
  return 0
}

# Drops exactly the two lines persist_brew_shellenv appended — the marker and
# the shellenv line directly under it — and nothing else. A brew shellenv line
# the user added themselves has no marker above it and survives.
edit_profile() {
  local f="$1" tmp
  tmp="$(mktemp)" || return 1
  awk -v marker="$PROFILE_MARKER" '
    index($0, marker) { skip = 1; next }
    skip && $0 ~ /brew shellenv/ { skip = 0; next }
    { skip = 0; print }
  ' "$f" > "$tmp" || { rm -f "$tmp"; return 1; }
  cat "$tmp" > "$f" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
  return 0
}

remove_selected() {
  local i=0 any=false
  heading "Removing"
  while [ "$i" -lt "${#T_KEY[@]}" ]; do
    if [ "${T_SEL[$i]}" = "y" ]; then
      run_removal "$i"
      any=true
    fi
    i=$((i + 1))
  done
  $any || step_skip "Nothing selected"
}

# ─── phase 6: Homebrew ───────────────────────────────────────────────────────

offer_homebrew() {
  [ -n "$BREW_BIN" ] || return 0
  have "$BREW_BIN" 2>/dev/null || [ -x "$BREW_BIN" ] || return 0

  local formulae casks total sample ours_still_listed i
  formulae="$("$BREW_BIN" list --formula 2>/dev/null | wc -l | tr -d ' ')"
  casks="$("$BREW_BIN" list --cask 2>/dev/null | wc -l | tr -d ' ')"
  total=$((formulae + casks))

  # "Other" has to mean other. After a real run the packages this script
  # removed are already gone from brew's own lists, but under --dry-run they
  # are all still there, so discount the ones it would have taken.
  ours_still_listed=0
  if $OPT_DRY; then
    i=0
    while [ "$i" -lt "${#T_KEY[@]}" ]; do
      if [ "${T_SEL[$i]}" = "y" ]; then
        case "${T_CMD[$i]}" in *"brew uninstall"*) ours_still_listed=$((ours_still_listed + 1)) ;; esac
      fi
      i=$((i + 1))
    done
  fi
  total=$((total - ours_still_listed))

  heading "Homebrew"
  if $BREW_FROM_INSTALLER; then
    step_info "This installer put Homebrew here $(dim '(its marker is in your shell profile)')"
  else
    step_info "Homebrew was already here $(dim 'before NanoClaw — no installer marker in your shell profile')"
  fi
  blank
  if [ "$total" -le 0 ]; then
    step_info "Homebrew manages nothing else."
  else
    # Sample both lists: a cask the user cares about makes the stakes far
    # clearer than four alphabetically-first formulae.
    sample="$({ "$BREW_BIN" list --cask 2>/dev/null; "$BREW_BIN" list --formula 2>/dev/null; } |
      grep -v -e '^orbstack$' -e '^docker-desktop$' -e '^codex$' -e '^node@24$' |
      head -4 | tr '\n' ' ')"
    say "  Removing Homebrew also removes the $(bold "$total") other package(s) it manages:"
    say "    $(dim "$sample")$(dim "$([ "$total" -gt 4 ] && printf '… and %s more' "$((total - 4))")")"
    blank
    say "  $(yellow 'This cannot be undone, and most of it has nothing to do with NanoClaw.')"
  fi
  blank

  # Deliberately not satisfied by --yes: a flag meant to skip small
  # confirmations must not be able to take out an unrelated toolchain.
  if $OPT_DRY; then
    step_info "would ask for the typed word 'homebrew' here; --yes does not answer it"
    return 0
  fi
  if ! $HAS_TTY; then
    step_skip "Keeping Homebrew — no terminal to confirm on"
    return 0
  fi
  if ! confirm_word "  Type 'homebrew' to remove it, or press Enter to keep it: " homebrew; then
    step_skip "Keeping Homebrew"
    return 0
  fi

  printf '  %s Removing Homebrew…' "$(dim '·')"
  # Absolute shell: a PATH-resolved bash can be a foreign shell, and
  # setup/installer-shell.test.ts holds every root-level .sh to this.
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)" \
    >> "$LOG" 2>&1
  local rc=$?
  if $USE_ANSI; then printf '\r\033[K'; else printf '\n'; fi
  if [ "$rc" -eq 0 ]; then
    step_ok "Homebrew removed"
    REMOVED=$((REMOVED + 1))
    manual_add "Homebrew's uninstaller leaves some directories behind on purpose; it printed the list above."
  else
    step_fail "Homebrew — removal failed, see $LOG"
    FAILED=true
  fi
}

# ─── phase 7: what is left ───────────────────────────────────────────────────

closing() {
  if [ "${#MANUAL[@]}" -gt 0 ]; then
    heading "Left for you"
    local i=0
    while [ "$i" -lt "${#MANUAL[@]}" ]; do
      printf '  %s. %s\n' "$((i + 1))" "${MANUAL[$i]}"
      i=$((i + 1))
    done
  fi

  if $CODEX_CONFIG_KEPT && [ -d "$HOME/.codex" ]; then
    heading "Kept on purpose"
    say "  $(dim 'Your Codex sign-in and config are still in ~/.codex — the binary was')"
    say "  $(dim 'removed, the account was not. Remove it too, if you want:')"
    blank
    say "      $(bold 'rm -rf ~/.codex')"
  fi

  # The checkout is deleted by hand, never from in here: this script is a file
  # inside it, and bash reads a script incrementally as it executes. Same
  # reason nanoclaw.sh --uninstall ends by telling you to delete the folder.
  if [ -n "$PROJECT_ROOT" ] && [ -d "$PROJECT_ROOT" ]; then
    heading "The folder itself"
    say "  This script lives in it, so it cannot delete it while running:"
    blank
    say "      $(bold "rm -rf $PROJECT_ROOT")"
    blank
    say "  $(dim 'The NanoClaw uninstaller backs up .env before removing it; check its')"
    say "  $(dim 'output above for where, if you still need those keys.')"
  fi

  blank
  say "$(dim "Log: $LOG")"
}

# ─── main ────────────────────────────────────────────────────────────────────

main() {
  blank
  say "$(bold 'NanoClaw — uninstall')"
  say "$(dim "$PLATFORM$($IS_WSL && printf ' (WSL)')${PROJECT_ROOT:+ · $PROJECT_ROOT}")"

  # Phase 1 before phase 3: the NanoClaw uninstall deletes logs/, and the
  # installer's provenance record lives in logs/install-deps/handoff.json.
  classify_all

  report

  local removable; removable="$(t_count_state ours)"

  if $OPT_CHECK; then
    heading "NanoClaw"
    if $OPT_KEEP_NANOCLAW; then
      step_skip "Not considered (--keep-nanoclaw)"
    elif [ -z "$PROJECT_ROOT" ] || ! is_nanoclaw_checkout "$PROJECT_ROOT"; then
      step_skip "No checkout found"
    elif nanoclaw_artifacts_found; then
      step_info "Installed — would be handed to nanoclaw.sh --uninstall"
    else
      step_ok "Already removed"
    fi
    blank
    say "$(dim "$removable removable, $(t_count_state foreign) left alone. Nothing was changed.")"
    exit 0
  fi

  if [ "$removable" -gt 0 ]; then
    if ! $OPT_YES && ! $OPT_DRY && ! $HAS_TTY; then
      blank
      say "$(red 'No terminal to ask on.') Nothing has been removed."
      say "Re-run with --check to see what this would touch, or --yes to take all"
      say "$removable prerequisite(s) above without asking."
      exit 4
    fi
    decide
  fi

  delegate_nanoclaw
  sweep_orphan_watchers

  if [ "$(t_count_selected)" -gt 0 ]; then
    remove_selected
  elif [ "$removable" -gt 0 ]; then
    heading "Removing"
    step_skip "Nothing selected"
  fi

  offer_homebrew
  closing

  if $OPT_DRY; then
    blank
    say "$(dim 'Dry run — nothing was changed.')"
    exit 0
  fi
  if $FAILED; then exit 1; fi
  if [ "${#MANUAL[@]}" -gt 0 ]; then exit 3; fi
  if [ "$REMOVED" -eq 0 ] && [ "$removable" -gt 0 ]; then exit 4; fi
  exit 0
}

main
