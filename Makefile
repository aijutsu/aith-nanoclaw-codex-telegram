# NanoClaw operator tasks.
#
# Requires GNU Make. It ships with macOS and Ubuntu; on Windows use Git Bash,
# MSYS2, WSL, or `choco install make`.
#
# Every recipe is a single `pnpm exec` call with no shell-specific syntax, so
# it behaves the same whether Make runs it through sh or cmd.exe.

PNPM ?= pnpm
TSX := $(PNPM) exec tsx

.PHONY: help add-notion-connection list-notion-connections remove-notion-connection

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
