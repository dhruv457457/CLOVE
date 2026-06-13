# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** This runs Next.js 16 (Turbopack). APIs and conventions differ from Next.js 13/14 training data. Read `node_modules/next/dist/docs/` before writing framework-level code.

> **Architecture sections verified against the tree 2026-06-13.** The codebase moved past the original single-agent / x402 model: there is no `aiCompiler.ts`, no `clove-agent.ts`, no `/api/x402/*`, no `/api/agent/{compile,run-ai,run}`. Execution now goes through the **1Shot public relayer**; creation through **`questions` → `from-answers`**; running through **`run-stream`** (planner + tools). If a pointer below is wrong, fix it — don't trust it blindly.

---

## Commands

```bash
npm run dev      # Start dev server (Turbopack, localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
npx tsc --noEmit # Type-check without emitting (run this after every change)
```

No test runner is configured. Verification is done by hitting API routes directly.

---

## What This Is

**CLOVE** is an autonomous DeFi agent OS on Base mainnet. Users describe a strategy → AI compiles it into a visual workflow → agent executes it autonomously using a delegated USDC budget.

**The agent loop:**
1. User grants ERC-7715 permission (recurring USDC budget). The final hop of the delegation chain targets the **1Shot public relayer** (`0x26a5…`), not a 1Shot server wallet.
2. User describes strategy → Venice compiles it → `/api/agent/questions` (questionnaire) → `/api/agent/from-answers` builds a team of agents, each with its own scoped on-chain USDC cap → saved to MongoDB.
3. Agent runs on schedule (`src/instrumentation.ts` ticks `/api/agent/cron` every 60s on Railway, or Vercel cron):
   - `/api/agent/run-stream` runs a **goal → plan → execute → reflect** loop (`planner.ts` + `tools.ts`), streamed over SSE.
   - Tools (`checkYields`, `checkRisk`, `executeDefi`, `rebalance`, `notifyUser`, plus copy-trade and rebalancer tools) call `/api/execute/defi`, which redeems the delegation through the **1Shot public relayer** (gas paid in USDC from the bundle).
   - MongoDB stores run history, current position, APY snapshots, and per-run reflections for future context.

---

## Key Architecture Decisions

### Chain: Base mainnet only (chainId 8453)
`src/lib/web3/config.ts` — `CHAIN = base`, USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. No testnet mode.

### Venice AI is OpenAI-compatible
`src/lib/venice/client.ts` uses `new OpenAI({ baseURL: "https://api.venice.ai/api/v1" })`. Pass `venice_parameters: { include_venice_system_prompt: false }` in every call. `VENICE_MODELS`: `compiler: qwen3-5-9b` (only model that honours `response_format: json_object`), `analyst: zai-org-glm-5-1` (planning), `reasoning: llama-3.3-70b` (reflection + `checkRisk` web-search), `fast: llama-3.2-3b`.

### Execution via the 1Shot public relayer
`src/lib/oneshot/publicRelayer.ts` — permissionless EIP-7710 gas abstraction, **no API key**. `executeViaPublicRelayer()`: `relayer_getFeeData` (USDC fee quote) → build a bundle `[USDC.transfer → feeCollector, USDC.transfer → recipient]` → `relayer_send7710Transaction` → poll `relayer_getStatus` (200=confirmed) until a txHash lands. Base relayer target `0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a`, feeCollector `0xE936e8FAf4A5655469182A49a505055B71C17604`. Gas is paid in USDC from the user's delegation — no ETH anywhere. `/api/relay/fee` exposes the quote; `/api/relay/webhook` lets the relayer nudge a poll early (needs `PUBLIC_BASE_URL`). `/api/intelligence` is now called **directly** with `internalHeaders()` (server-to-server).

### Agent execution is server-side (plan → execute → reflect)
No ReAct/`clove-agent.ts` anymore. `src/lib/agent/planner.ts` (`veniceGeneratePlan` → subgoals, `veniceReflect` → memory insight) + `src/lib/agent/tools.ts` (`TOOL_DEFINITIONS` + `executeTool`). The tool catalog is type-scoped via `src/lib/agent/agentTypes.ts`: base DeFi tools (`checkYields`, `checkRisk`, `executeDefi`, `rebalance`, `notifyUser`), copy-trade tools (`discoverWhales`, `checkWhaleTrades`, `executeCopyTrade`), rebalancer tools (`checkRealYields`, `monitorPositions`), and meta-tools (`addThought`, `revisePlan`) that mutate the live canvas. Driven by `/api/agent/run-stream` (SSE).

### Canvas ≠ execution
There is **no `BlueprintCanvas.tsx`**. The hub canvas is inline in `src/app/dashboard/page.tsx` (`@xyflow/react`, inline `AgentNode` at `NODE_TYPES`, design-token consts like `ACCENT = #C8FF3D` — no `NODE_STYLES` export). The workflow detail canvas is `src/app/dashboard/workflow/[id]/page.tsx` (`CopyDeskView` + orchestrated A2A view via `/api/workflow/[id]/orchestrate`). Pressing Run calls `/api/agent/run-stream`; the canvas nodes visualize the loop, they don't constrain tool calls.

### MongoDB for persistence
`src/lib/db/mongodb.ts` — singleton client, DB name `clove`. Collections: `agent_runs`, `agent_positions`, `apy_snapshots`, `workflows`, `schedules`. All writes are fire-and-forget (non-fatal). Functions in `src/lib/agent/memory.ts`.

### ERC-7715 permission
`src/lib/web3/permissions.ts` — `requestUsdcPermission()` calls `walletClient.requestExecutionPermissions()` (MetaMask). Returns `permissionsContext` (hex delegation chain) + `delegationManager`. Regular MetaMask v12+ supports this but returns a near-empty context; MetaMask Flask returns a valid one. Revocation via `DelegationManager.disableDelegation(bytes32)`.

### Delegation chain & redemption
Grants are scoped on our side with `@metamask/smart-accounts-kit` (`src/lib/web3/subDelegation.ts`, `decodeDelegations`), with the final hop targeting the public relayer. The authenticated 1Shot `executeAsDelegator` path was **removed** — `/api/execute/defi` redeems exclusively through `relayer_send7710Transaction` (see `publicRelayer.ts`). Deposits route through the `CloveAutoDeposit` contract (`src/lib/web3/cloveAutoDeposit.ts`, `CLOVE_AUTO_DEPOSIT` env): relayer delegates USDC to the contract, then `forward()`/`forwardSwap()` does the real protocol call. The 1Shot session/Fund-Manager EOA `0x5fA306c23C731039a998215f3432205Df8A34cF1` still holds the grant; it can be upgraded to a smart account in-flight via an EIP-7702 `authorizationList` (`src/lib/web3/upgrade7702.ts`).

---

## Environment Variables

```
ONESHOT_API_KEY / ONESHOT_API_SECRET / ONESHOT_BUSINESS_ID / ONESHOT_WALLET_ID
NEXT_PUBLIC_CLOVE_SESSION_ADDRESS   # 1Shot wallet address (public)
VENICE_API_KEY                      # OpenAI-compat key for Venice
MONGODB_URI                         # mongodb+srv://... → DB name hardcoded as "clove"
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
BASE_RPC                            # Base mainnet RPC (optional; defaults to public RPC)
ONESHOT_METHOD_*                    # contract-method UUIDs — REQUIRED for on-chain execution
CLOVE_AUTO_DEPOSIT                  # CloveAutoDeposit contract — relayer sends USDC here, then forward() deposits
PUBLIC_BASE_URL                     # always-on host base URL → enables relayer webhook nudge (optional; polls if unset)
CLOVE_INTERNAL_SECRET               # REQUIRED for internal server-to-server calls (intelligence/TTS/image)
TAVILY_API_KEY / FAL_API_KEY / EXA_API_KEY   # optional — skip gracefully if missing
CRON_SECRET                         # Vercel cron auth header
```

---

## API Routes Reference

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/agent/questions` | POST | Venice → questionnaire that refines a raw strategy prompt |
| `/api/agent/from-answers` | POST | Builds the agent team + scoped on-chain delegation chains; saves to MongoDB |
| `/api/agent/run-stream` | POST | Plan → execute → reflect loop (planner + tools), streamed over SSE |
| `/api/workflow/[id]/orchestrate` | POST | Runs the orchestrated A2A pipeline (Scout → Risk → Executor) for a workflow |
| `/api/agent/cron` | GET | Cron — loads all enabled schedules from MongoDB, runs each |
| `/api/agent/schedule` | POST/GET | Save/load schedule config (MongoDB) |
| `/api/agent/memory/prompt` | GET `?wallet=` | Full memory string for Venice injection |
| `/api/agent/memory/run` | POST | Save a run result to MongoDB |
| `/api/intelligence` | GET | Live Venice yield data; auth via `internalHeaders()` (server-to-server) |
| `/api/yields/live` | GET | Live DeFiLlama yields for Base |
| `/api/whale/discover` · `/api/whale/activity` | GET | Smart-money discovery + tracked-wallet on-chain swaps (copy-trade) |
| `/api/execute/defi` | POST | Encode protocol calldata; redeem via the 1Shot public relayer (`executeViaPublicRelayer`) |
| `/api/relay/fee` | GET | Relayer USDC fee quote |
| `/api/relay/webhook` | POST | Relayer status push → nudges an in-flight poll |
| `/api/notify/telegram` · `/api/telegram/*` | POST/GET | Telegram send, webhook, wallet link |
| `/api/session/address` | GET | Returns the 1Shot session wallet address |

---

## Agents & Canvas

`src/lib/agent/agentTypes.ts` defines the agent archetypes (yield, copy-trader, rebalancer, …) and which tools each may call — there is **no** `aiCompiler.ts` / `NodeType`. The canvas is a ReactFlow visualization of the running plan: the hub canvas + `AgentNode` are inline in `src/app/dashboard/page.tsx`; the per-workflow canvas is `src/app/dashboard/workflow/[id]/page.tsx`. Colors come from local design-token consts (e.g. `ACCENT = #C8FF3D`), not a `NODE_STYLES` map.

## Protocol Addresses (Base mainnet)

Defined in `src/lib/protocols/addresses.ts`. Key: Morpho Blue `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, Morpho Moonwell USDC vault `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca`. Execution actions live in the `METHOD_REGISTRY` in `/api/execute/defi`: `morpho-vault-deposit`, `aave-supply`, `uniswap-swap-exact-input`, `aerodrome-swap-exact-tokens`, `lido-wrap` (USDC→wstETH swap on Base). **Aave v3 replaces Sky/sUSDS** for execution — Sky has no direct USDC deposit on Base (`AAVE_V3`; Sky kept as reference only).

## Important Patterns

- All server-only modules start with `import "server-only"` — never import in client components
- `terminalStore` (`src/lib/walletEmulator.ts`) is the in-memory log ring buffer (200 entries); used for UI feedback only
- `metamaskStore` (`src/lib/web3/metamaskStore.ts`) is a singleton class with listeners — use `addListener()` to subscribe in components
- Venice fallback: every Venice call degrades gracefully — `veniceGeneratePlan` retries (GLM ×2 → qwen json-mode) then uses a type-aware `fallbackPlan`; `veniceReflect` falls back to a truthful hold/insight; `checkRisk` falls back from web-search to a keyword heuristic (all in `planner.ts` / `tools.ts`)
- `import "server-only"` modules cannot be imported in `"use client"` files — memory, DB, Venice, 1Shot are all server-only
