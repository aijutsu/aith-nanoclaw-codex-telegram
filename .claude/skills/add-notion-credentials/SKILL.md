---
name: add-notion-credentials
description: Add Make targets that put a Notion integration token into the OneCLI vault and manage it - `make add-notion-connection`, `make list-notion-connections`, `make remove-notion-connection`. Use when an agent needs Notion access through the credentials proxy, or when the Notion MCP server returns 401/unauthorized because no credential is vaulted.
---

# Notion credentials via the OneCLI vault

Gives an operator three Make targets for the Notion credential:

| Target | Does |
|--------|------|
| `make add-notion-connection` | prompts for the token with the input hidden, stores it, rotates in place if one already exists |
| `make list-notion-connections` | lists vault secrets; never prints a token value |
| `make remove-notion-connection` | shows the target, asks, then deletes it |

## Why this exists

**Notion is not an OAuth app in OneCLI's catalogue.** `onecli apps list` returns
gmail, github, gitlab, google-*, resend — no Notion. So there is no
**Apps → Connect** flow, and an operator looking for one finds nothing. The
credential is instead a plain `generic` secret with the header injection spelled
out by hand:

```
--type generic  --host-pattern api.notion.com
--header-name Authorization  --value-format 'Bearer {value}'
```

Get any one of those four wrong and the secret stores fine but is never
injected, which surfaces later as an unexplained 401. That exact shape is the
thing this skill exists to own.

**Why the token is not passed as `--value`.** `onecli secrets create` accepts
`--value`, but argv is world-readable through `ps`. The script writes the token
to a 0600 temp file and passes `--file`, removing it in a `finally`.

**Why not `docker exec` into the gateway.** The `onecli` container ships only a
Node server — it has no `onecli` executable on its PATH, so
`docker exec onecli onecli …` fails with *executable file not found*. The CLI is
a per-platform native binary on the host. The script resolves it via
`ONECLI_BIN` → a manual PATH scan → known install dirs, so it never assumes PATH.

## Apply

1. **Copy the script and its test into the project's tree.**

   ```bash
   cp "${CLAUDE_SKILL_DIR}/files/notion-connection.ts" scripts/notion-connection.ts
   cp "${CLAUDE_SKILL_DIR}/files/notion-connection.test.ts" scripts/notion-connection.test.ts
   ```

2. **Add the Make targets.** If the project has no `Makefile`, create one:

   ```make
   PNPM ?= pnpm
   TSX := $(PNPM) exec tsx

   .PHONY: add-notion-connection list-notion-connections remove-notion-connection

   add-notion-connection:
   	@$(TSX) scripts/notion-connection.ts add

   list-notion-connections:
   	@$(TSX) scripts/notion-connection.ts list

   remove-notion-connection:
   	@$(TSX) scripts/notion-connection.ts remove
   ```

   If a `Makefile` already exists, **append the three targets and add their
   names to the existing `.PHONY`** rather than overwriting the file. Recipes
   must be TAB-indented, not spaces.

   Keep each recipe a single `$(TSX)` call with no shell-specific syntax: it has
   to behave the same whether Make runs it through `sh` or `cmd.exe`. GNU Make
   ships with macOS and Ubuntu; on Windows it needs Git Bash, MSYS2, WSL, or
   `choco install make`.

3. **Verify.**

   ```bash
   pnpm exec vitest run scripts/notion-connection.test.ts
   make list-notion-connections
   ```

   The list should render a table with an `ID` column and no value column.

This is safe to re-run: step 1 overwrites, step 2 skips targets already present.

## Usage

```
$ make add-notion-connection
Notion internal integration token (input hidden):
Created the "Notion" secret.
```

The token comes from **notion.so/profile/integrations → New integration**, with
**read + update + insert content**. Read-only is enough to brief from but breaks
every write.

**One more step Notion requires:** a valid token still sees nothing until the
integration is connected to the pages — open the parent page, then
**··· → Connections → pick the integration**. Child pages inherit.

`remove` resolves the secret itself, by `hostPattern == api.notion.com`, so the
operator never handles an id. If more than one secret matches it refuses to
guess, prints the table, and asks for `--id` (the reason `list` shows ids at
all).

Flags when calling the script directly: `--dry-run`, `--yes`, `--id <id>`.
`NOTION_TOKEN=… ` or a piped token drives `add` non-interactively.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Could not find the OneCLI binary` | CLI not on PATH and not in a known dir | `ONECLI_BIN=/path/to/onecli make add-notion-connection` |
| Token stored, calls still 401 | injection flags wrong, or the agent's OneCLI agent is `secretMode: selective` | `onecli secrets list` to check the host pattern and header; `onecli agents list` to check the mode |
| `object_not_found` on a page that exists | token is fine; the integration was never connected to the page | share the parent page with the integration (above) |
| `Removing a connection needs an interactive terminal` | destructive command in a non-TTY | add `--yes`, or `--dry-run` to preview |
| Make errors with "missing separator" | recipe indented with spaces | re-indent with a TAB |

No restart is needed after adding or removing — the gateway resolves secrets per
request.
