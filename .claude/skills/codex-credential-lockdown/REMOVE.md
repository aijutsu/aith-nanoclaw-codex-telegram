# Remove: codex-credential-lockdown

Reverses everything `SKILL.md` applied. **Removing this restores an
out-of-band credential path**: codex agents regain the Apps/Connectors bridge
and can reach any service the vaulted ChatGPT account has connected, without
the vault issuing or being able to revoke that access. Remove it only
deliberately.

1. **Delete the gateway rules.**

   ```bash
   onecli rules list          # find the two ids
   onecli rules delete --id <block-codex-connectors-id>
   onecli rules delete --id <block-codex-plugin-catalog-id>
   ```

   To disable without deleting: `onecli rules update --id <id> --enabled false`.

2. **Revert the two reach-ins.**

   - `container/Dockerfile`: delete the `# ---- Codex credential lockdown`
     block and its `COPY codex-managed-config.toml …` line.
   - `container/agent-runner/src/index.ts`: delete the `withMcpGatewayEnv`
     import and the comment above the `mcpServers` line, and pass the map
     straight through again: `mcpServers,`.

3. **Delete the fork-owned files.** Do this *with* step 2, never before: on its
   own the test is the only thing that would tell you the reach-ins are gone.

   ```bash
   rm -f container/codex-managed-config.toml
   rm -f container/agent-runner/src/mcp-gateway-env.ts
   rm -f container/agent-runner/src/codex-credential-lockdown.test.ts
   ```

4. **Rebuild and verify.**

   ```bash
   cd container/agent-runner && bun test && cd ../..
   pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
   ./container/build.sh
   ncl groups restart --id <group-id>
   ```

   `codex features list` in the image should again show `apps`, `plugins` and
   `remote_plugin` as `true`, and `.codex-shared/config.toml` should have no
   proxy vars under `[mcp_servers.*.env]` after the next spawn.

Not touched by this removal: the `.codex-shared/cache/codex_apps_*` caches (stale
either way), the vaulted ChatGPT account's own connectors, and any secret in the
vault.
