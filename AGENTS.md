# AGENTS.md

## Project overview

`0xAuto` / `AutoA2A` is a demo of an MCP-native, Agent-to-Agent (A2A) DeFi automation
engine. It is an npm-workspaces monorepo:

- `packages/mcp-server` — MCP server exposing mock DeFi tools (`list_markets`,
  `get_price`, `get_portfolio`, `swap_tokens`, `stake`). Source-only TypeScript
  (ESM, NodeNext), run via `tsx`.
- `apps/web` — Next.js (App Router) agent-builder UI plus the A2A executor
  (`Coordinator` → `PriceWatcher` → `Trader`) that connects to the MCP server as a
  real MCP client and drives the DeFi tools.

Standard commands (lint/test/build/dev/run) are documented in `README.md` under
"Local development (demo)". Use those; they are not duplicated here.

## Cursor Cloud specific instructions

- Dependencies are installed by the startup update script (`npm install` at the
  repo root). You normally do not need to reinstall.
- Run the app with `npm run dev` (Next.js dev server on port 3000). This is the
  primary application; there is no separate backend process to start — the A2A
  executor and the MCP server both run in-process inside the Next.js Node runtime
  (connected over an in-memory MCP transport), so a single `npm run dev` is enough
  to exercise the whole flow end-to-end.
- `npm run mcp` runs the DeFi MCP server standalone over **stdio**. It intentionally
  blocks waiting for an MCP client on stdin and logs only to stderr; that is normal,
  not a hang. It is not required for the web demo.
- The mock DeFi state (prices, balances, staked positions) is an in-memory singleton
  in `packages/mcp-server`. It persists for the lifetime of the running dev-server
  process and resets whenever that process restarts. Execution history (`apps/web`)
  is likewise in-memory and non-persistent.
- Editing files under `packages/mcp-server` is picked up by the web app because Next
  transpiles that workspace package (`transpilePackages`) and a webpack
  `extensionAlias` resolves its NodeNext-style `.js` import specifiers to the `.ts`
  sources. If you change `next.config.mjs`, restart `npm run dev` for it to take effect.
- No secrets or external services are required; everything is mocked and local.
