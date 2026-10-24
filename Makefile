# NanoClaw operator tasks.
#
# Requires GNU Make. It ships with macOS and Ubuntu; on Windows use Git Bash,
# MSYS2, WSL, or `choco install make`.
#
# Every recipe is a single `pnpm exec` call with no shell-specific syntax, so
# it behaves the same whether Make runs it through sh or cmd.exe. Two
# exceptions, both plain bash because they run when pnpm cannot: `install-deps`
# has to work before Node exists, and `uninstall` has to work after it is gone.

PNPM ?= pnpm
TSX := $(PNPM) exec tsx

.PHONY: help add-notion-connection list-notion-connections remove-notion-connection reload-community-agent

help:
	@$(TSX) scripts/notion-connection.ts help

## Add or rotate the Notion integration token in the OneCLI vault.
## Prompts for the token with the input hidden; never takes it as an argument.
add-notion-connection:
	@$(TSX) scripts/notion-connection.ts add

## List the secrets held in the OneCLI vault. Token values are never printed.
list-notion-connections:
	@$(TSX) scripts/notion-connection.ts list

## Remove the Notion secret from the OneCLI vault. Shows the target and asks
## before deleting; the token cannot be recovered afterwards.
remove-notion-connection:
	@$(TSX) scripts/notion-connection.ts remove

## Stop every container of the community agent and reset its chat conversations,
## so the next message starts fresh on the current instructions. Refuses (and
## stops nothing) if the agent image is missing or personality.md won't compose.
## Override the group with FOLDER=<slug>.
reload-community-agent:
	@$(TSX) scripts/reload-community-agent.ts $(if $(FOLDER),--folder $(FOLDER),)

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
