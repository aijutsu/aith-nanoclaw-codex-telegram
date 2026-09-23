# Connecting Notion

Notion is this agent's one external credential: it holds the community's members, events, items,
loans and requests. The `notion` MCP server ships with this plugin and starts on its own, but it
starts **unauthenticated** — the real token comes from the credentials proxy at request time, so
the first call fails until someone connects it.

## How to use this reference

This is **orientation**. Guide the person in your own words. **Expect the UI to have drifted**, so
adapt to what they tell you they see on their screen.

Don't paste the whole setup as one wall. Send a small batch (two or three steps), let them reply
"done," then send the next. Keep the language plain.

## What "not connected" looks like

The Notion MCP tools will come back with one of these. They mean different things, so read the
error before you send anyone anywhere:

| What you see | What it means | What to do |
|--------------|---------------|------------|
| `401`, `unauthorized`, `API token is invalid` | no credential in the vault yet (the server is sending its placeholder) | *Create the integration*, then *Connect it*, below |
| `object_not_found` on a page or database you know exists | the token is fine; the integration just hasn't been given access to that page | *Sharing pages with the integration*, below |
| `restricted_resource` | the integration's capabilities are too narrow | *Create the integration* — check read **and** write content are enabled |
| `409`, `conflict_error` | someone edited the same page at the same moment | just retry once |

## Create the integration (once)

Notion has no sign-in-with-Notion connector here, so the community makes an **internal
integration** and hands over its token. In the browser, signed in as someone with admin rights on
the workspace:

1. Go to **notion.so/profile/integrations** → **New integration**.
2. Name it something the community will recognise later (the agent's name is a good choice), and
   pick the workspace it should act in.
3. Give it **read, update, and insert content** capabilities. Read-only is enough to brief from,
   but nothing else in this agent works — no loans, no RSVPs, no requests.
4. It has no access to any page yet. That's the next section, and it's the step most setups miss.
5. Copy the **Internal Integration Token** (it starts `ntn_`). Treat it like a password: it goes
   into the credentials proxy, never into the group chat, and never to you in a message.

## Connect it

The token belongs to the credentials proxy, which injects it into every call to `api.notion.com`.
Two ways in, and the first is usually already done for you:

- **From the error.** When a Notion call fails for want of a credential, the gateway's error
  carries a **connect link** for that host. Hand them that link, they paste the token there, and
  you retry the original call. Prefer this: the link is prefilled for the right host.
- **Straight from the dashboard.** Otherwise the proxy's web UI is usually at
  **http://127.0.0.1:10254** (the address is instance-configurable) — add a secret for host
  `api.notion.com` with the token as a bearer credential.

Never ask them to paste the token to you, and never offer to put it in a file or an env var.
Ground rule: you don't handle credential values.

## Sharing pages with the integration

A fresh integration can see **nothing**, even with a perfect token — this is Notion's model, not a
misconfiguration, and it's why a working token still returns `object_not_found`.

Share the **one parent page** that holds the community's databases, and everything under it comes
with it:

1. Open the community's parent page in Notion.
2. **···** (top right) → **Connections** → **Connect to** → pick the integration by name.
3. Confirm. Child pages and databases inherit, so this is one action, not one per database.

If the databases don't exist yet, share an empty parent page first — then you can create them
yourself (`notion-workspace.md`, *Creating them*) and they inherit the access.

## Remote box?

If NanoClaw runs on a remote machine or VM, the connect link won't open as-is: the proxy's web UI
isn't reachable from their browser at the VM's local address. Guide them through an SSH tunnel from
their own machine; never suggest exposing the proxy publicly when a tunnel is possible, and don't
dead-end them or send them to an admin.

1. Find where the proxy actually listens; on a VM it's often `172.17.0.1:10254` (the Docker
   bridge), not `localhost`.
2. From their own machine: `ssh -L 10255:172.17.0.1:10254 <user>@<vm-host>` (a local `10255`
   dodges any proxy already on `10254`).
3. They open `http://localhost:10255` in their browser and paste the token there.

Creating the Notion integration itself happens on notion.so in their normal browser, so only this
last step needs the tunnel.

## Common snags

- **Token works, everything is `object_not_found`**: the integration was never connected to the
  parent page. Back to *Sharing pages*.
- **Worked yesterday, `401` today**: the integration was revoked or the workspace owner removed
  it. Check notion.so/profile/integrations before assuming the vault is at fault.
- **Wrong workspace**: an integration is bound to the workspace it was created in. If the
  community has more than one, a token from the wrong one reads as an empty, permission-less
  workspace. Have them check the workspace name on the integration page.
- **Writes fail, reads work**: the integration has read-only capabilities. Edit it and re-check
  update + insert.

Until Notion is connected, say so plainly and keep working from what you have — memory and the
chat still let you answer plenty. Don't silently degrade to guessing.
