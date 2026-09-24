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

2. **Revert the reach-in** in
   `container/agent-runner/src/providers/codex-app-server.ts`:

   - delete the `CODEX_DISABLED_FEATURES` and `CODEX_MCP_GATEWAY_ENV` constants;
   - delete `codexMcpGatewayEnvSection` and the `mcpGatewayEnv` field on
     `CodexConfigPlan`, and its line in `buildCodexConfigPlan`;
   - in `renderCodexConfigToml`, delete the `CODEX_DISABLED_FEATURES` loop from
     the `[features]` block, and restore the stdio env guard to its original
     form:

     ```ts
     if (config.env && Object.keys(config.env).length > 0) {
       lines.push(`[mcp_servers.${tomlName}.env]`);
       for (const [key, value] of Object.entries(config.env)) {
         lines.push(`${tomlKey(key)} = ${tomlBasicString(value)}`);
       }
     }
     ```

3. **Delete the standalone guard.**

   ```bash
   rm -f container/agent-runner/src/providers/codex-credential-lockdown.test.ts
   ```

   Do this *with* step 2, never before it: on its own the guard is the only
   thing that would tell you the reach-in is gone.

4. **Revert the tests** added to
   `container/agent-runner/src/providers/codex-app-server.test.ts`: the
   feature-flag assertion, the three gateway-env tests, and the
   `codexMcpGatewayEnvSection` test. Restore the exact-bytes test — drop the
   `mcpGatewayEnv: {}` override and the three `[features]` lines from its
   expected output, and remove `codexMcpGatewayEnvSection` from the import and
   from the plan assertion in the capability test.

5. **Rebuild and verify.**

   ```bash
   cd container/agent-runner && bun test
   pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
   ./container/build.sh
   ncl groups restart --id <group-id>
   ```

   After the next spawn, `.codex-shared/config.toml` should again show
   `[features]` with only `memories = false`, and no proxy vars under
   `[mcp_servers.*.env]`.

Not touched by this removal: the `.codex-shared/cache/codex_apps_*` caches (stale
either way), the vaulted ChatGPT account's own connectors, and any secret in the
vault.
