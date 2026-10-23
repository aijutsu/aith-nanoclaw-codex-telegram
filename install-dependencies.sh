#!/usr/bin/env bash
#
# install-dependencies.sh — install every prerequisite the course documents, in
# the order the course documents them, then hand off to `nanoclaw.sh`.
#
# Two entry points, one implementation:
#
#   cold start (nothing cloned yet)
#     curl -fsSL https://raw.githubusercontent.com/aijutsu/aith-nanoclaw-codex-telegram/main/install-dependencies.sh | /bin/bash
#
#   inside a checkout
#     make install-deps
#
# Source of truth for every command below is the course, one page per tool:
#   course/001-building-agents-with-nanoclaw/01-installations/
# Students read those pages, so a command here that differs from the page is a
# documentation bug. Two deliberate divergences, both forced by the repo's
# absolute-shell rule (see setup/installer-shell.test.ts): the Codex fallback
# pipes to /bin/sh rather than `sh`, and get-docker.sh is downloaded to a
# private temp dir rather than the cwd (which on a cold start is $HOME).
#
# Check-first and idempotent: anything already installed is reported with its
# version and never reinstalled. Re-running changes nothing.
#
# Deliberately NOT installed:
#   Bun         — pinned in container/Dockerfile (ARG BUN_VERSION), installed
#                 inside the image and verified there by setup/container.ts.
#                 On the host it is dead weight.
#   Claude Code — optional in the course; Codex is the agent provider.
#
# `set -e` is deliberately absent: every step records its own status through
# run_step so one failed cask cannot abort the other tools. Same reasoning as
# migrate-v2.sh.
set -uo pipefail

VERSION="1.0.0"
REPO_URL="https://github.com/aijutsu/aith-nanoclaw-codex-telegram.git"

# ─── options ─────────────────────────────────────────────────────────────────

OPT_YES=false
OPT_CHECK=false
OPT_SKIP_CLONE=false
OPT_SKIP_BUILD=false
OPT_DIR="${NANOCLAW_INSTALL_DIR:-$HOME/nanoclaw}"
OPT_DOCKER="${NANOCLAW_DOCKER_RUNTIME:-}"

usage() {
  cat <<'USAGE'
Usage: install-dependencies.sh [options]

Installs the course prerequisites — Homebrew, git, jq, Docker, Make, Node,
pnpm, Codex — then clones NanoClaw, installs host dependencies and pre-builds
the agent image. Checks first: anything already installed is reported, never
reinstalled.

Options:
  -y, --yes                 Skip the confirmation and take recommended
                            defaults. Required when there is no terminal.
      --check               Detect and report only. Installs nothing.
      --docker <runtime>    macOS container runtime: orbstack (default) or
                            docker-desktop. Pre-answers the only question.
      --dir <path>          Clone target. Default: ~/nanoclaw
      --skip-clone          Install prerequisites only.
      --skip-build          Do not pre-build the agent image.
  -h, --help                Show this and exit.

Exit codes:
  0  ready          1  an install failed        2  unsupported environment
  3  manual action required                     4  declined / no terminal
  5  --check found missing prerequisites
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)      OPT_YES=true; shift ;;
    --check)       OPT_CHECK=true; shift ;;
    --skip-clone)  OPT_SKIP_CLONE=true; shift ;;
    --skip-build)  OPT_SKIP_BUILD=true; shift ;;
    --dir)         OPT_DIR="${2:-}"; shift 2 ;;
    --dir=*)       OPT_DIR="${1#*=}"; shift ;;
    --docker)      OPT_DOCKER="${2:-}"; shift 2 ;;
    --docker=*)    OPT_DOCKER="${1#*=}"; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$OPT_DOCKER" in
  ''|orbstack|docker-desktop) ;;
  *) printf 'Invalid --docker value: %s (want orbstack or docker-desktop)\n' \
       "$OPT_DOCKER" >&2; exit 2 ;;
esac

# ─── output ──────────────────────────────────────────────────────────────────
#
# Inlined rather than sourced from the tree: a cold start has no checkout to
# source from until phase 4, and by then most of the work is done. Near-twins
# of these live in nanoclaw.sh and migrate-v2.sh; if you change the look,
# change all three.

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
LOG="${LOG_DIR%/}/nanoclaw-install-deps.$$.log"
: > "$LOG" 2>/dev/null || LOG=/dev/null
log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG" 2>/dev/null || true; }
log "install-dependencies.sh $VERSION starting"

# ─── tool registry ───────────────────────────────────────────────────────────
#
# Parallel indexed arrays, not one associative array: /bin/bash on macOS is
# 3.2, which has no `declare -A`. Same approach as migrate-v2.sh.
#
# State is one of:
#   present  already installed, nothing to do
#   missing  will be installed
#   manual   cannot be installed from here; the user has a step to perform
#   blocked  an install ran and the tool is still not usable

T_KEY=()
T_LABEL=()
T_STATE=()
T_DETAIL=()

t_add() {
  T_KEY[${#T_KEY[@]}]="$1"
  T_LABEL[${#T_LABEL[@]}]="$2"
  T_STATE[${#T_STATE[@]}]="$3"
  T_DETAIL[${#T_DETAIL[@]}]="$4"
  log "detect $1: $3 ${4:-}"
}

t_index() {
  local i=0
  while [ "$i" -lt "${#T_KEY[@]}" ]; do
    if [ "${T_KEY[$i]}" = "$1" ]; then printf '%s' "$i"; return 0; fi
    i=$((i + 1))
  done
  printf '%s' '-1'
  return 1
}

t_state() {
  local i; i=$(t_index "$1") || { printf '%s' 'unknown'; return 1; }
  printf '%s' "${T_STATE[$i]}"
}

t_detail() {
  local i; i=$(t_index "$1") || { printf '%s' ''; return 1; }
  printf '%s' "${T_DETAIL[$i]}"
}

t_label() {
  local i; i=$(t_index "$1") || { printf '%s' "$1"; return 1; }
  printf '%s' "${T_LABEL[$i]}"
}

t_set() {
  local i; i=$(t_index "$1") || return 1
  T_STATE[$i]="$2"
  if [ $# -ge 3 ]; then T_DETAIL[$i]="$3"; fi
  log "state $1 -> $2 ${3:-}"
}

t_count_state() {
  local want="$1" i=0 n=0
  while [ "$i" -lt "${#T_KEY[@]}" ]; do
    if [ "${T_STATE[$i]}" = "$want" ]; then n=$((n + 1)); fi
    i=$((i + 1))
  done
  printf '%s' "$n"
}

MANUAL=()
manual_add() {
  MANUAL[${#MANUAL[@]}]="$1"
  log "manual action: $1"
}

# ─── handoff ─────────────────────────────────────────────────────────────────

EXIT_CODE=0
REPO_DIR=""

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g'
}

write_handoff() {
  local code=$?
  [ -n "$REPO_DIR" ] || return 0
  local dir="$REPO_DIR/logs/install-deps"
  mkdir -p "$dir" 2>/dev/null || return 0
  cp "$LOG" "$dir/install-deps.log" 2>/dev/null || true
  {
    printf '{\n'
    printf '  "version": "%s",\n' "$VERSION"
    printf '  "finished_at": "%s",\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf '  "exit_code": %s,\n' "$code"
    printf '  "platform": "%s",\n' "$(json_escape "$PLATFORM")"
    printf '  "is_wsl": %s,\n' "$IS_WSL"
    printf '  "tools": {\n'
    local i=0
    while [ "$i" -lt "${#T_KEY[@]}" ]; do
      printf '    "%s": { "state": "%s", "detail": "%s" }' \
        "$(json_escape "${T_KEY[$i]}")" \
        "$(json_escape "${T_STATE[$i]}")" \
        "$(json_escape "${T_DETAIL[$i]}")"
      i=$((i + 1))
      if [ "$i" -lt "${#T_KEY[@]}" ]; then printf ',\n'; else printf '\n'; fi
    done
    printf '  },\n'
    printf '  "manual_actions": [\n'
    i=0
    while [ "$i" -lt "${#MANUAL[@]}" ]; do
      printf '    "%s"' "$(json_escape "${MANUAL[$i]}")"
      i=$((i + 1))
      if [ "$i" -lt "${#MANUAL[@]}" ]; then printf ',\n'; else printf '\n'; fi
    done
    printf '  ]\n'
    printf '}\n'
  } > "$dir/handoff.json" 2>/dev/null || true
}

# ─── small helpers ───────────────────────────────────────────────────────────

have() { command -v "$1" >/dev/null 2>&1; }

first_line() { head -n 1 2>/dev/null; }

# Interactivity is "can I read an answer", which is /dev/tty — never stdin.
# Under `curl | bash` stdin IS the script, so migrate-v2.sh's `! [ -t 0 ]`
# gate would reject every legitimate cold-start run. The redirect probe also
# catches a /dev/tty that exists while the process has no controlling
# terminal, which would otherwise fail inside the first prompt.
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

# ─── phase 0: environment ────────────────────────────────────────────────────

PLATFORM="unknown"
IS_WSL=false
IS_ROOT=false
PKG=""

# Test seams: NANOCLAW_UNAME_S, NANOCLAW_KERNEL_RELEASE, NANOCLAW_PROC_VERSION
# and NANOCLAW_PKG. Read only by platform detection, so the WSL 1 / WSL 2 /
# Fedora branches are assertable from a macOS box without changing a single
# production behaviour.
UNAME_S="${NANOCLAW_UNAME_S:-$(uname -s)}"
KERNEL_RELEASE="${NANOCLAW_KERNEL_RELEASE:-$(uname -r 2>/dev/null || echo '')}"

proc_version() {
  if [ -n "${NANOCLAW_PROC_VERSION:-}" ]; then
    printf '%s\n' "$NANOCLAW_PROC_VERSION"
  elif [ -f /proc/version ]; then
    cat /proc/version 2>/dev/null
  fi
}

# WSL 2 kernels carry "-WSL2"; WSL 1 reports e.g. 4.4.0-19041-Microsoft.
# `wslinfo` is authoritative on WSL >= 2.0 but absent on older builds.
wsl_major() {
  if have wslinfo; then
    local v; v=$(wslinfo --wsl-version 2>/dev/null | cut -d. -f1)
    if [ -n "$v" ]; then printf '%s' "$v"; return 0; fi
  fi
  case "$KERNEL_RELEASE" in
    *WSL2*|*wsl2*)                 printf '%s' '2' ;;
    *microsoft-standard|*Microsoft) printf '%s' '1' ;;
    *)                             printf '%s' '' ;;
  esac
}

detect_platform() {
  case "$UNAME_S" in
    Darwin*) PLATFORM="macos" ;;
    Linux*)  PLATFORM="linux" ;;
    *)       PLATFORM="unknown" ;;
  esac

  if [ "$PLATFORM" = "linux" ] && proc_version | grep -qi 'microsoft\|wsl'; then
    IS_WSL=true
  fi
  if [ "$(id -u)" -eq 0 ]; then IS_ROOT=true; fi

  if [ "$PLATFORM" = "linux" ]; then
    if [ -n "${NANOCLAW_PKG:-}" ];  then PKG="$NANOCLAW_PKG"
    elif have apt-get;              then PKG="apt"
    elif have dnf;                  then PKG="dnf"
    fi
  fi

  log "platform=$PLATFORM is_wsl=$IS_WSL is_root=$IS_ROOT pkg=${PKG:-none} kernel=$KERNEL_RELEASE"
}

detect_platform
trap write_handoff EXIT

if [ "$PLATFORM" = "unknown" ]; then
  blank
  say "$(red 'Unsupported system:') $UNAME_S"
  say "NanoClaw runs on macOS and Linux. On Windows, install WSL first and run"
  say "this inside the Ubuntu terminal:"
  blank
  say "    wsl --install"
  blank
  exit 2
fi

if $IS_WSL; then
  WSL_MAJOR="$(wsl_major)"
  if [ "$WSL_MAJOR" = "1" ]; then
    blank
    say "$(red 'This is WSL 1.') Homebrew does not work on WSL 1, and every tool"
    say "after it is installed with Homebrew."
    blank
    say "In PowerShell, as Administrator:"
    blank
    say "    wsl --set-version Ubuntu 2"
    blank
    say "Then reopen the Ubuntu terminal and run this again."
    exit 2
  fi
  # An unknown answer proceeds. A false positive would hard-block a working
  # WSL 2 machine; a false negative only reproduces today's behaviour, where
  # Homebrew fails with its own message.
  log "wsl major=${WSL_MAJOR:-unknown}"
fi

if [ "$PLATFORM" = "linux" ] && $IS_ROOT; then
  blank
  say "$(red 'Running as root.') Homebrew refuses to run as root, so this cannot"
  say "continue. Create a regular user with sudo and run it again:"
  blank
  say "    adduser nanoclaw"
  say "    usermod -aG sudo nanoclaw"
  say "    su - nanoclaw"
  blank
  exit 2
fi

if [ "$PLATFORM" = "linux" ] && [ -z "$PKG" ]; then
  blank
  say "$(red 'No supported package manager.') Need apt or dnf."
  say "Ubuntu 22.04/24.04/26.04 and Fedora are the supported distributions."
  exit 2
fi

# ─── sudo ────────────────────────────────────────────────────────────────────
#
# "One confirmation, then unattended" is a promise about sudo's timestamp, not
# just about prompts. A Command Line Tools install runs 5-10 minutes and
# outlives sudo's default 5-minute cache, so without a keepalive the run dies
# on an invisible password prompt partway through. The course's own
# 02-setting-up-nanoclaw/03-run-setup page already tells students to prime
# sudo for the same reason.

SUDO_KEEPALIVE_PID=""
NEEDS_SUDO=false

sudo_prime() {
  $NEEDS_SUDO || return 0
  have sudo || return 0
  if sudo -n true 2>/dev/null; then return 0; fi
  if ! $HAS_TTY; then return 1; fi
  say "  $(dim 'Your password is needed to install system packages.')"
  sudo -v < /dev/tty || return 1
}

sudo_keepalive_start() {
  $NEEDS_SUDO || return 0
  have sudo || return 0
  ( while kill -0 $$ 2>/dev/null; do sudo -n true 2>/dev/null; sleep 50; done ) &
  SUDO_KEEPALIVE_PID=$!
  log "sudo keepalive pid=$SUDO_KEEPALIVE_PID"
}

sudo_keepalive_stop() {
  if [ -n "$SUDO_KEEPALIVE_PID" ]; then
    kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
    SUDO_KEEPALIVE_PID=""
  fi
}

# Re-probe before each sudo step: if the keepalive died, re-prompt visibly
# rather than hang on a prompt the user cannot see.
sudo_ready() {
  have sudo || return 1
  if sudo -n true 2>/dev/null; then return 0; fi
  if $HAS_TTY; then sudo -v < /dev/tty && return 0; fi
  return 1
}

# ─── homebrew environment ────────────────────────────────────────────────────

brew_candidates() {
  printf '%s\n' /opt/homebrew/bin/brew /usr/local/bin/brew \
    /home/linuxbrew/.linuxbrew/bin/brew "$HOME/.linuxbrew/bin/brew"
}

# Put brew on PATH for THIS process. The course tells the student to copy the
# "Next steps" lines the installer prints; doing it here makes that
# deterministic instead of a manual copy-paste.
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

profile_file() {
  local shell_name
  shell_name="$(basename "${SHELL:-/bin/bash}")"
  case "$shell_name" in
    zsh)  printf '%s' "$HOME/.zprofile" ;;
    bash) if [ "$PLATFORM" = "macos" ]; then printf '%s' "$HOME/.bash_profile"
          else printf '%s' "$HOME/.bashrc"; fi ;;
    *)    if [ "$PLATFORM" = "macos" ]; then printf '%s' "$HOME/.profile"
          else printf '%s' "$HOME/.bashrc"; fi ;;
  esac
}

NEW_SHELL_NEEDED=false

persist_brew_shellenv() {
  local brew_bin line profile
  brew_bin="$(command -v brew 2>/dev/null)" || return 0
  [ -n "$brew_bin" ] || return 0
  line="eval \"\$($brew_bin shellenv)\""
  profile="$(profile_file)"
  touch "$profile" 2>/dev/null || return 0
  if grep -Fq 'brew shellenv' "$profile" 2>/dev/null; then
    log "brew shellenv already in $profile"
    return 0
  fi
  {
    printf '\n# Added by NanoClaw install-dependencies.sh\n'
    printf '%s\n' "$line"
  } >> "$profile"
  NEW_SHELL_NEEDED=true
  log "appended brew shellenv to $profile"
  step_info "Added Homebrew to $profile"
}

# ─── phase 1: detection ──────────────────────────────────────────────────────
#
# One probe per tool, in the course's order. Nothing here mutates the system
# except load_brew_env, which only fixes PATH for this process.

apt_or_dnf_install() {
  # $@ = package names
  if [ "$PKG" = "dnf" ]; then
    sudo dnf install -y "$@"
  else
    sudo apt install -y "$@"
  fi
}

probe_brew() {
  if load_brew_env || have brew; then
    t_add brew "Homebrew" present "$(brew --version 2>/dev/null | first_line)"
  else
    t_add brew "Homebrew" missing ""
    NEEDS_SUDO=true
  fi
}

probe_git() {
  if have git; then
    t_add git "Git" present "$(git --version 2>/dev/null | first_line)"
  else
    t_add git "Git" missing ""
    [ "$PLATFORM" = "linux" ] && NEEDS_SUDO=true
  fi
}

probe_jq() {
  if have jq; then
    t_add jq "jq" present "$(jq --version 2>/dev/null | first_line)"
  else
    t_add jq "jq" missing ""
    [ "$PLATFORM" = "linux" ] && NEEDS_SUDO=true
  fi
}

# A runtime can be installed without its CLI symlinks if it has never been
# launched, so this looks for the app, not just the `docker` command.
mac_runtime_installed() {
  if [ -d /Applications/Docker.app ]; then printf '%s' 'docker-desktop'; return 0; fi
  if [ -d /Applications/OrbStack.app ]; then printf '%s' 'orbstack'; return 0; fi
  if have brew; then
    if brew list --cask docker-desktop >/dev/null 2>&1; then printf '%s' 'docker-desktop'; return 0; fi
    if brew list --cask orbstack >/dev/null 2>&1; then printf '%s' 'orbstack'; return 0; fi
  fi
  printf '%s' ''
  return 1
}

wsl_docker_desktop_installed() {
  [ -f "/mnt/c/Program Files/Docker/Docker Desktop/Docker Desktop.exe" ] ||
  [ -f "/mnt/c/Program Files/Docker/Docker Desktop/resources/bin/docker" ]
}

DOCKER_NEEDS_CHOICE=false

probe_docker() {
  if have docker; then
    local v; v="$(docker --version 2>/dev/null | first_line)"
    if docker info >/dev/null 2>&1; then
      t_add docker "Docker" present "$v"
    else
      t_add docker "Docker" present "$v (not running)"
      if [ "$PLATFORM" = "macos" ]; then
        manual_add "Start your container runtime (OrbStack or Docker Desktop), then check: docker run hello-world"
      elif $IS_WSL; then
        manual_add "Start Docker Desktop on Windows, then check: docker run hello-world"
      else
        manual_add "Start Docker: sudo systemctl start docker — or log out and back in if you were just added to the docker group"
      fi
    fi
    return 0
  fi

  if [ "$PLATFORM" = "macos" ]; then
    local existing; existing="$(mac_runtime_installed)"
    if [ -n "$existing" ]; then
      # Already have a runtime. Never install a second one.
      t_add docker "Docker" manual "$existing installed, not started"
      if [ "$existing" = "docker-desktop" ]; then
        manual_add "Open Docker from Applications, accept the Subscription Service Agreement, choose 'Use recommended settings' and wait for the whale icon. You can skip signing in."
      else
        manual_add "Open OrbStack from Applications. If it asks what to use it for, choose Docker."
      fi
      return 0
    fi
    t_add docker "Docker" missing ""
    DOCKER_NEEDS_CHOICE=true
    return 0
  fi

  if $IS_WSL; then
    # Docker Desktop is a Windows app. Installing Docker Engine inside Ubuntu
    # instead is the outcome the course explicitly calls wrong, so this is
    # always a manual step — never an install.
    if wsl_docker_desktop_installed; then
      t_add docker "Docker" manual "Docker Desktop installed on Windows, WSL integration off"
      manual_add "Enable WSL integration: open Docker Desktop, go to Settings (gear) → Resources → WSL integration, turn on Ubuntu, click Apply, then close and reopen this Ubuntu terminal."
    else
      t_add docker "Docker" manual "Docker Desktop not installed on Windows"
      manual_add "Install Docker Desktop on the Windows side (not inside Ubuntu): https://docs.docker.com/desktop/setup/install/windows-install/ — download 'Docker Desktop for Windows - x86_64', keep 'Use WSL 2 instead of Hyper-V' ticked, restart, then enable Settings → Resources → WSL integration → Ubuntu → Apply and reopen this terminal."
    fi
    return 0
  fi

  t_add docker "Docker" missing ""
  NEEDS_SUDO=true
}

probe_make() {
  if have make && make --version 2>/dev/null | first_line | grep -q '^GNU Make'; then
    t_add make "Make" present "$(make --version 2>/dev/null | first_line)"
  else
    t_add make "Make" missing ""
    [ "$PLATFORM" = "linux" ] && NEEDS_SUDO=true
  fi
}

# nvm/fnm/asdf/volta put their shims ahead of Homebrew on PATH, so linking a
# brew Node over one of them leaves the next terminal on the old version —
# and setup.sh would then re-trigger its own install-node.sh fallback. Hand
# those back to the user's own version manager instead.
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

probe_node() {
  if have node; then
    local v major
    v="$(node --version 2>/dev/null | sed 's/^v//')"
    major="$(printf '%s' "$v" | cut -d. -f1)"
    if [ "$major" -ge 22 ] 2>/dev/null; then
      t_add node "Node.js" present "v$v ($(command -v node))"
      return 0
    fi
    local mgr; mgr="$(node_manager)"
    if [ -n "$mgr" ]; then
      t_add node "Node.js" manual "v$v under $mgr — too old"
      case "$mgr" in
        nvm)   manual_add "Upgrade Node with nvm (NanoClaw needs 22 or newer): nvm install 24 && nvm alias default 24" ;;
        fnm)   manual_add "Upgrade Node with fnm (NanoClaw needs 22 or newer): fnm install 24 && fnm default 24" ;;
        asdf)  manual_add "Upgrade Node with asdf (NanoClaw needs 22 or newer): asdf install nodejs 24.0.0 && asdf global nodejs 24.0.0" ;;
        volta) manual_add "Upgrade Node with volta (NanoClaw needs 22 or newer): volta install node@24" ;;
      esac
      return 0
    fi
    t_add node "Node.js" missing "v$v is too old (need 22+)"
    return 0
  fi
  t_add node "Node.js" missing ""
}

probe_pnpm() {
  if have pnpm; then
    t_add pnpm "pnpm" present "$(pnpm --version 2>/dev/null | first_line)"
  else
    t_add pnpm "pnpm" missing ""
  fi
}

probe_codex() {
  if have codex; then
    t_add codex "Codex" present "$(codex --version 2>/dev/null | first_line)"
  else
    t_add codex "Codex" missing ""
  fi
}

detect_all() {
  T_KEY=(); T_LABEL=(); T_STATE=(); T_DETAIL=()
  probe_brew
  probe_git
  probe_jq
  probe_docker
  probe_make
  probe_node
  probe_pnpm
  probe_codex
}

# ─── installers ──────────────────────────────────────────────────────────────
#
# Every command below is the course's, verbatim. scripts/install-dependencies.test.ts
# asserts each one, so editing a command here without editing the course page
# (or the other way round) goes red.

install_brew() {
  if [ "$PLATFORM" = "linux" ]; then
    sudo_ready || return 1
    if [ "$PKG" = "dnf" ]; then
      sudo dnf install -y @development-tools procps-ng curl file git || return 1
    else
      sudo apt update && sudo apt install -y build-essential procps curl file git || return 1
    fi
  fi
  # NONINTERACTIVE keeps the installer from waiting on a RETURN that nobody
  # is watching for; the single confirmation already covered this.
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || return 1
  load_brew_env || return 1
  persist_brew_shellenv
}

install_git() {
  if [ "$PLATFORM" = "macos" ]; then
    brew install git jq
  else
    sudo_ready || return 1
    if [ "$PKG" = "dnf" ]; then sudo dnf install -y git; else sudo apt install -y git; fi
  fi
}

install_jq() {
  if [ "$PLATFORM" = "macos" ]; then
    brew install git jq
  else
    sudo_ready || return 1
    if [ "$PKG" = "dnf" ]; then sudo dnf install -y jq; else sudo apt install -y jq; fi
  fi
}

install_docker() {
  if [ "$PLATFORM" = "macos" ]; then
    local runtime="${OPT_DOCKER:-orbstack}"
    local app="OrbStack"
    if [ "$runtime" = "docker-desktop" ]; then
      brew install --cask docker-desktop || return 1
      app="Docker"
    else
      brew install --cask orbstack || return 1
    fi
    open -a "$app" 2>/dev/null || true

    # Best effort: the first-run dialogs are GUI and cannot be driven, so
    # wait a little and only hand the step back if it did not complete.
    local waited=0
    while [ "$waited" -lt 60 ]; do
      if docker info >/dev/null 2>&1; then
        log "docker became ready after ${waited}s"
        return 0
      fi
      sleep 3
      waited=$((waited + 3))
    done

    if [ "$runtime" = "docker-desktop" ]; then
      manual_add "Finish Docker Desktop's first run: accept the Subscription Service Agreement, choose 'Use recommended settings', then wait for the whale icon in the menu bar. You can skip signing in."
    else
      manual_add "Finish OrbStack's first run: if it asks what to use it for, choose Docker. It may ask for your Mac password."
    fi
    return 0
  fi

  # Linux. Downloaded to a private temp dir rather than the cwd, which on a
  # cold start is $HOME.
  sudo_ready || return 1
  local tmp; tmp="$(mktemp -d)" || return 1
  curl -fsSL https://get.docker.com -o "$tmp/get-docker.sh" || { rm -rf "$tmp"; return 1; }
  sudo /bin/sh "$tmp/get-docker.sh" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  sudo usermod -aG docker "$USER" || true
  manual_add "Log out and log back in so your user picks up the docker group, then check: docker run hello-world"
  return 0
}

CLT_PENDING=false

install_make() {
  if [ "$PLATFORM" = "macos" ]; then
    # Comes from Command Line Tools, which the Homebrew install already
    # triggers. The course deliberately avoids `brew install make`, which
    # provides gmake and leaves `make` alone.
    if xcode-select -p >/dev/null 2>&1; then
      hash -r 2>/dev/null || true
      have make && return 0
    fi
    xcode-select --install 2>/dev/null || true
    CLT_PENDING=true
    manual_add "Finish the Command Line Tools install: click Install in the window that opened and wait for it to finish, then run this script again."
    return 0
  fi
  sudo_ready || return 1
  if [ "$PKG" = "dnf" ]; then sudo dnf install -y make; else sudo apt install -y make; fi
}

install_node() {
  have brew || { log "install_node: no brew"; return 1; }
  brew install node@24 || return 1
  if ! brew link --force node@24 2>/dev/null; then
    # node@24 is keg-only; an existing `node` link blocks it.
    brew unlink node 2>/dev/null || true
    brew link --force node@24 || return 1
  fi
  hash -r 2>/dev/null || true
  NEW_SHELL_NEEDED=true
}

install_pnpm() {
  # corepack's first-use "Do you want to continue? [Y/n]" would hang
  # invisibly; setup.sh suppresses it the same way for the same reason.
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  if have corepack && have brew; then
    if corepack enable --install-directory "$(brew --prefix)/bin" pnpm 2>/dev/null; then
      hash -r 2>/dev/null || true
      have pnpm && { NEW_SHELL_NEEDED=true; return 0; }
    fi
  fi
  # Node 25+ dropped corepack.
  if have npm; then
    npm install -g pnpm@10 || return 1
    hash -r 2>/dev/null || true
    NEW_SHELL_NEEDED=true
    return 0
  fi
  return 1
}

install_codex() {
  if have brew && brew install --cask codex; then
    hash -r 2>/dev/null || true
    NEW_SHELL_NEEDED=true
    return 0
  fi
  # Absolute shell: a PATH-resolved `sh` can be a foreign shell.
  curl -fsSL https://chatgpt.com/codex/install.sh | /bin/sh || return 1
  hash -r 2>/dev/null || true
  NEW_SHELL_NEEDED=true
}

# ─── reporting ───────────────────────────────────────────────────────────────

if $USE_ANSI; then clear_line() { printf '\r\033[K'; }
else clear_line() { printf '\n'; }
fi

# What will actually run, shown before the confirmation so the user approves
# commands rather than a vague promise.
plan_cmd() {
  case "$1" in
    brew)
      if [ "$PLATFORM" = "macos" ]; then
        printf '%s' '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
      elif [ "$PKG" = "dnf" ]; then
        printf '%s' 'sudo dnf install -y @development-tools procps-ng curl file git, then the Homebrew installer'
      else
        printf '%s' 'sudo apt update && sudo apt install -y build-essential procps curl file git, then the Homebrew installer'
      fi ;;
    git)
      if [ "$PLATFORM" = "macos" ]; then printf '%s' 'brew install git jq'
      elif [ "$PKG" = "dnf" ]; then printf '%s' 'sudo dnf install -y git'
      else printf '%s' 'sudo apt install -y git'; fi ;;
    jq)
      if [ "$PLATFORM" = "macos" ]; then printf '%s' 'brew install git jq'
      elif [ "$PKG" = "dnf" ]; then printf '%s' 'sudo dnf install -y jq'
      else printf '%s' 'sudo apt install -y jq'; fi ;;
    docker)
      if [ "$PLATFORM" = "macos" ]; then
        if [ "${OPT_DOCKER:-orbstack}" = "docker-desktop" ]; then
          printf '%s' 'brew install --cask docker-desktop'
        else
          printf '%s' 'brew install --cask orbstack'
        fi
      else
        printf '%s' 'curl -fsSL https://get.docker.com, then sudo sh it, then sudo usermod -aG docker'
      fi ;;
    make)
      if [ "$PLATFORM" = "macos" ]; then printf '%s' 'xcode-select --install'
      elif [ "$PKG" = "dnf" ]; then printf '%s' 'sudo dnf install -y make'
      else printf '%s' 'sudo apt install -y make'; fi ;;
    node)  printf '%s' 'brew install node@24 && brew link --force node@24' ;;
    pnpm)  printf '%s' 'corepack enable --install-directory "$(brew --prefix)/bin" pnpm' ;;
    codex) printf '%s' 'brew install --cask codex' ;;
    *)     printf '%s' '' ;;
  esac
}

report() {
  local i=0 state
  heading "Already installed"
  local any=false
  while [ "$i" -lt "${#T_KEY[@]}" ]; do
    if [ "${T_STATE[$i]}" = "present" ]; then
      step_ok "$(printf '%-10s' "${T_LABEL[$i]}") $(dim "${T_DETAIL[$i]}")"
      any=true
    fi
    i=$((i + 1))
  done
  $any || step_info "$(dim 'nothing yet')"

  if [ "$(t_count_state missing)" -gt 0 ]; then
    heading "Will install"
    i=0
    while [ "$i" -lt "${#T_KEY[@]}" ]; do
      if [ "${T_STATE[$i]}" = "missing" ]; then
        printf '  %s %s\n' "$(yellow '+')" "$(bold "${T_LABEL[$i]}")"
        printf '      %s\n' "$(dim "$(plan_cmd "${T_KEY[$i]}")")"
      fi
      i=$((i + 1))
    done
  fi

  if [ "$(t_count_state manual)" -gt 0 ]; then
    heading "Needs you"
    i=0
    while [ "$i" -lt "${#T_KEY[@]}" ]; do
      if [ "${T_STATE[$i]}" = "manual" ]; then
        step_manual "$(printf '%-10s' "${T_LABEL[$i]}") $(dim "${T_DETAIL[$i]}")"
      fi
      i=$((i + 1))
    done
  fi
}

verify_tool() {
  case "$1" in
    brew)   have brew   && brew --version 2>/dev/null | first_line ;;
    git)    have git    && git --version 2>/dev/null | first_line ;;
    jq)     have jq     && jq --version 2>/dev/null | first_line ;;
    docker) have docker && docker --version 2>/dev/null | first_line ;;
    make)   have make   && make --version 2>/dev/null | first_line | grep '^GNU Make' ;;
    node)   have node   && node --version 2>/dev/null | first_line ;;
    pnpm)   have pnpm   && pnpm --version 2>/dev/null | first_line ;;
    codex)  have codex  && codex --version 2>/dev/null | first_line ;;
  esac
}

FAILED=false

# The single place anything is executed. `set -e` is off, so every status
# check lives here rather than being scattered — which is what makes that
# safe.
run_step() {
  local key="$1" label fn rc v
  label="$(t_label "$key")"
  fn="install_$key"
  printf '  %s Installing %s…' "$(dim '·')" "$label"
  log "=== install $key ==="
  "$fn" >> "$LOG" 2>&1
  rc=$?
  clear_line

  if [ "$rc" -ne 0 ]; then
    t_set "$key" blocked "install failed"
    step_fail "$label — install failed, see $LOG"
    FAILED=true
    return 1
  fi

  v="$(verify_tool "$key")"
  if [ -n "$v" ]; then
    t_set "$key" present "$v"
    step_ok "$label $(dim "$v")"
    return 0
  fi

  # Installed, but not usable yet. Some of those are expected.
  if [ "$key" = "docker" ] && [ "$PLATFORM" = "macos" ]; then
    t_set "$key" manual "installed, first run not finished"
    step_manual "$label — installed, finish its first run"
  elif [ "$key" = "make" ] && $CLT_PENDING; then
    t_set "$key" manual "Command Line Tools install pending"
    step_manual "$label — finish the Command Line Tools install"
  else
    t_set "$key" blocked "installed but not on PATH"
    step_fail "$label — installed but not on PATH yet; open a new terminal and re-run"
    FAILED=true
    return 1
  fi
  return 0
}

# ─── phase 4: the checkout ───────────────────────────────────────────────────

SCRIPT_PATH="${BASH_SOURCE[0]:-}"

# Under `curl | bash` there is no script file, so this falls through to the
# clone. Run from inside a checkout (make install-deps) it finds that
# checkout and never clones a second copy.
script_checkout() {
  local d
  [ -n "$SCRIPT_PATH" ] || return 1
  [ -f "$SCRIPT_PATH" ] || return 1
  d="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd)" || return 1
  [ -f "$d/nanoclaw.sh" ] || return 1
  [ -f "$d/setup.sh" ] || return 1
  [ -f "$d/package.json" ] || return 1
  printf '%s' "$d"
}

is_nanoclaw_checkout() {
  [ -f "$1/nanoclaw.sh" ] && [ -f "$1/setup.sh" ] && [ -f "$1/package.json" ]
}

resolve_repo() {
  local here
  here="$(script_checkout)" && {
    REPO_DIR="$here"
    step_skip "Already in a NanoClaw checkout — $REPO_DIR"
    return 0
  }

  if $OPT_SKIP_CLONE; then
    step_skip "Skipping the clone (--skip-clone)"
    return 0
  fi

  if [ -d "$OPT_DIR" ]; then
    if is_nanoclaw_checkout "$OPT_DIR"; then
      REPO_DIR="$OPT_DIR"
      step_skip "NanoClaw is already at $OPT_DIR — leaving it alone"
      return 0
    fi
    step_fail "$OPT_DIR exists and is not a NanoClaw checkout"
    say "      Move it aside, or pass --dir <other-path>."
    FAILED=true
    return 1
  fi

  printf '  %s Cloning NanoClaw into %s…' "$(dim '·')" "$OPT_DIR"
  if git clone "$REPO_URL" "$OPT_DIR" >> "$LOG" 2>&1; then
    clear_line
    REPO_DIR="$OPT_DIR"
    step_ok "Cloned into $REPO_DIR"
    return 0
  fi
  clear_line
  step_fail "Clone failed, see $LOG"
  FAILED=true
  return 1
}

# ─── phase 5: host dependencies ──────────────────────────────────────────────
#
# setup.sh is the repo's own dependency bootstrap: Node check, a five-tier
# pnpm acquisition ladder, `pnpm install --frozen-lockfile`, and a
# better-sqlite3 native smoke test. It prints a machine-readable status block.
# nanoclaw.sh and migrate-v2.sh both call it exactly this way.

run_setup_sh() {
  [ -n "$REPO_DIR" ] || return 0
  local steps="$REPO_DIR/logs/install-deps"
  mkdir -p "$steps" 2>/dev/null || true
  local out="$steps/bootstrap.log"

  printf '  %s Installing host dependencies…' "$(dim '·')"
  NANOCLAW_BOOTSTRAP_LOG="$steps/bootstrap-raw.log" \
    bash "$REPO_DIR/setup.sh" > "$out" 2>&1
  local rc=$?
  clear_line

  local status node_version native
  status="$(grep '^STATUS:' "$out" 2>/dev/null | head -1 | sed 's/^STATUS: *//')"
  node_version="$(grep '^NODE_VERSION:' "$out" 2>/dev/null | head -1 | sed 's/^NODE_VERSION: *//')"
  native="$(grep '^NATIVE_OK:' "$out" 2>/dev/null | head -1 | sed 's/^NATIVE_OK: *//')"
  log "setup.sh rc=$rc status=${status:-?} node=${node_version:-?} native=${native:-?}"

  # Replays nanoclaw.sh's pnpm PATH recovery: a system-wide Node puts the
  # corepack shim next to the node binary, which a non-root user cannot write.
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
  if ! have pnpm && have npm; then
    local prefix; prefix="$(npm config get prefix 2>/dev/null)"
    if [ -n "$prefix" ] && [ -x "$prefix/bin/pnpm" ]; then
      export PATH="$prefix/bin:$PATH"
    fi
  fi
  hash -r 2>/dev/null || true

  if [ "$rc" -eq 0 ] && [ "$status" = "success" ]; then
    step_ok "Host dependencies ready $(dim "Node $node_version")"
    return 0
  fi

  case "$rc" in
    2) step_fail "Node is missing or too old (setup.sh reported ${status:-node_missing})" ;;
    *) step_fail "Host dependencies failed (${status:-unknown}) — see $out" ;;
  esac
  tail -n 20 "$out" 2>/dev/null | sed 's/^/      /'
  FAILED=true
  return 1
}

# ─── phase 6: pre-build the agent image ──────────────────────────────────────
#
# Purely an optimisation: it moves a 3-10 minute build out of the interactive
# wizard. setup/container.ts builds the image anyway, so a skip costs nothing
# but a slower first setup. Never fail the run over it.

prebuild_image() {
  [ -n "$REPO_DIR" ] || return 0
  if $OPT_SKIP_BUILD; then step_skip "Skipping the image pre-build (--skip-build)"; return 0; fi
  if ! have docker; then step_skip "Image pre-build skipped — Docker is not ready yet"; return 0; fi

  local build_args=""
  local hardened
  hardened="$(grep '^NANOCLAW_HARDENED_IMAGE=' "$REPO_DIR/.env" 2>/dev/null | tail -n1 |
    cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
  if [ "$hardened" = "true" ]; then build_args="pull"; fi

  local log_file="$REPO_DIR/logs/install-deps/container-build.log"
  mkdir -p "$(dirname "$log_file")" 2>/dev/null || true

  if ! docker info >/dev/null 2>&1; then
    # Mirrors setup/container.ts: a fresh `usermod -aG docker` has not taken
    # effect in this shell, and sg runs the build under the new group without
    # a logout.
    if have sg && id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
      printf '  %s Pre-building the agent image (under sg docker)…' "$(dim '·')"
      if sg docker -c "bash '$REPO_DIR/container/build.sh' $build_args" > "$log_file" 2>&1; then
        clear_line; step_ok "Agent image built"
        return 0
      fi
      clear_line
      step_skip "Image pre-build skipped — setup will build it. See $log_file"
      return 0
    fi
    step_skip "Image pre-build skipped — Docker is not running yet; setup will build it"
    return 0
  fi

  printf '  %s Pre-building the agent image (3-10 min)…' "$(dim '·')"
  if bash "$REPO_DIR/container/build.sh" $build_args > "$log_file" 2>&1; then
    clear_line; step_ok "Agent image built"
  else
    clear_line
    step_skip "Image pre-build skipped — setup will build it. See $log_file"
  fi
  return 0
}

# ─── phase 7: diagnostics ────────────────────────────────────────────────────

send_diagnostics() {
  [ -n "$REPO_DIR" ] || return 0
  [ -f "$REPO_DIR/setup/lib/diagnostics.sh" ] || return 0
  # Subshell so nothing it defines or changes leaks back in here.
  (
    cd "$REPO_DIR" || exit 0
    PROJECT_ROOT="$REPO_DIR"
    export PROJECT_ROOT
    # shellcheck disable=SC1091
    . ./setup/lib/diagnostics.sh || exit 0
    ph_event install_deps_completed \
      platform="$PLATFORM" \
      is_wsl="$IS_WSL" \
      installed="$(t_count_state present)" \
      manual="${#MANUAL[@]}" \
      status="$($FAILED && printf 'failed' || printf 'ok')"
  ) >/dev/null 2>&1 || true
}

# ─── phase 8: next steps ─────────────────────────────────────────────────────

next_steps() {
  local target="${REPO_DIR:-$OPT_DIR}"

  if [ "${#MANUAL[@]}" -gt 0 ]; then
    heading "Do these first"
    local i=0
    while [ "$i" -lt "${#MANUAL[@]}" ]; do
      printf '  %s. %s\n' "$((i + 1))" "${MANUAL[$i]}"
      i=$((i + 1))
    done
  fi

  heading "Then"
  local n=1
  if $NEW_SHELL_NEEDED; then
    printf '  %s. %s\n' "$n" "Open a new terminal, so the tools just installed are on your PATH."
    n=$((n + 1))
  fi
  printf '  %s. %s\n' "$n" "Sign Codex in to your ChatGPT account:"
  printf '\n       %s\n\n' "$(bold 'codex')"
  printf '     %s\n' "$(dim 'Choose "Sign in with ChatGPT", finish in the browser, then type /quit.')"
  n=$((n + 1))
  printf '  %s. %s\n' "$n" "Set NanoClaw up:"
  printf '\n       %s\n' "$(bold "cd $target")"
  printf '       %s\n\n' "$(bold 'bash nanoclaw.sh --agent-provider codex')"
  printf '     %s\n' "$(dim 'Have your Telegram bot token from @BotFather ready.')"
  blank
  say "$(dim "Log: $LOG")"
}

# ─── main ────────────────────────────────────────────────────────────────────

main() {
  blank
  say "$(bold 'NanoClaw — course prerequisites')"
  say "$(dim "$PLATFORM$($IS_WSL && printf ' (WSL)')${PKG:+ · $PKG}")"

  detect_all

  if $OPT_CHECK; then
    report
    blank
    local missing_now manual_now
    missing_now="$(t_count_state missing)"
    manual_now="$(t_count_state manual)"
    if [ "$missing_now" -eq 0 ] && [ "$manual_now" -eq 0 ]; then
      say "$(green 'Everything the course needs is installed.')"
      exit 0
    fi
    if [ "${#MANUAL[@]}" -gt 0 ]; then
      heading "What you need to do"
      local i=0
      while [ "$i" -lt "${#MANUAL[@]}" ]; do
        printf '  %s. %s\n' "$((i + 1))" "${MANUAL[$i]}"
        i=$((i + 1))
      done
      blank
    fi
    say "$(yellow "$missing_now to install, $manual_now needing you.")"
    say "$(dim 'Run without --check to install them.')"
    exit 5
  fi

  # The one question, asked before the confirmation so the plan shows the
  # chosen runtime and the install itself needs no further input.
  if $DOCKER_NEEDS_CHOICE && [ -z "$OPT_DOCKER" ]; then
    if $HAS_TTY && ! $OPT_YES; then
      heading "Docker runtime"
      say "  1) OrbStack       $(dim 'recommended — lighter, free for personal use')"
      say "  2) Docker Desktop $(dim 'free for personal use, education and small business')"
      blank
      local choice; choice="$(ask "  Choose [1/2] (1): " "1")"
      case "$choice" in
        2) OPT_DOCKER="docker-desktop" ;;
        *) OPT_DOCKER="orbstack" ;;
      esac
    else
      OPT_DOCKER="orbstack"
    fi
    log "docker runtime choice: $OPT_DOCKER"
  fi

  report

  local to_install; to_install="$(t_count_state missing)"
  if [ "$to_install" -gt 0 ]; then
    if ! $OPT_YES; then
      if ! $HAS_TTY; then
        blank
        say "$(red 'No terminal to ask on.') Nothing has been installed."
        say "Re-run with --yes to install the $to_install prerequisites above:"
        blank
        say "    bash install-dependencies.sh --yes"
        blank
        exit 4
      fi
      blank
      if ! confirm "  Install the $to_install prerequisites above? [y/N] "; then
        blank
        say "Nothing installed."
        exit 4
      fi
    fi

    heading "Installing"
    if $NEEDS_SUDO; then
      if ! sudo_prime; then
        step_fail "Could not get sudo — system packages need it"
        FAILED=true
      fi
      sudo_keepalive_start
    fi

    local key
    for key in brew git jq docker make node pnpm codex; do
      if [ "$(t_state "$key")" = "missing" ]; then
        run_step "$key"
      fi
    done

    sudo_keepalive_stop
  else
    heading "Installing"
    step_skip "Nothing to install"
  fi

  # better-sqlite3 compiles against the Command Line Tools. Running
  # `pnpm install` while that GUI install is still going yields a native
  # build failure that looks like a NanoClaw bug, so stop here instead.
  if $CLT_PENDING; then
    blank
    say "$(yellow 'Waiting on the Command Line Tools install.')"
    say "Finish it in the window that opened, then run this again to continue."
    next_steps
    exit 3
  fi

  heading "NanoClaw"
  if resolve_repo && [ -n "$REPO_DIR" ]; then
    run_setup_sh && prebuild_image
    send_diagnostics
  fi

  next_steps

  if $FAILED; then exit 1; fi
  if [ "${#MANUAL[@]}" -gt 0 ]; then exit 3; fi
  exit 0
}

main
