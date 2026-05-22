# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** This runs Next.js 16 (Turbopack). APIs and conventions differ from Next.js 13/14 training data. Read `node_modules/next/dist/docs/` before writing framework-level code.

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

**CLOVE** is an autonomous DeFi agent OS on Base/Base Sepolia. Users describe a strategy → AI compiles it into a visual workflow → agent executes it autonomously using a delegated USDC budget.

**The agent loop:**
1. User grants ERC-7715 permission (recurring USDC budget) to CLOVE's 1Shot wallet
2. User describes strategy → Venice AI compiles to ReactFlow workflow → saved to MongoDB
3. Agent runs on schedule (Vercel cron or local 15s poll):
   - Calls `/api/x402/pay` → 1Shot redelegates permission → pays Venice via x402
   - Venice AI (ReAct loop) calls tools: `checkYields` → `checkRisk` → `executeDefi` OR `rebalance` → `notifyUser`
   - MongoDB stores run history, current position, APY snapshots for future context

---

## Key Architecture Decisions

### Chain: Base Sepolia only (testnet)
`src/lib/web3/config.ts` — USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, chain ID 84532.

### Venice AI is OpenAI-compatible
`src/lib/venice/client.ts` uses `new OpenAI({ baseURL: "https://api.venice.ai/api/v1" })`. Pass `venice_parameters: { include_venice_system_prompt: false }` in every call. Models: `qwen3-5-9b` (compiler), `zai-org-glm-5-1` (analyst), `llama-3.3-70b` (agent ReAct loop).

### x402 payment flow
`POST /api/x402/pay` → fetches 402 challenge from target endpoint → 1Shot `redelegateWithDelegationData` → gets facilitator signature → retries endpoint with `PAYMENT-SIGNATURE` header. `/api/intelligence` is the main x402-gated endpoint.

### Agent execution is server-side
`src/lib/agent/clove-agent.ts` — OpenAI function-calling ReAct loop (not Vercel AI SDK — that version doesn't support `maxSteps`). Venice decides which tools to call. Tools: `checkYields` (real x402), `checkRisk`, `executeDefi`, `rebalance`, `notifyUser`.

### Canvas ≠ execution
ReactFlow canvas (`src/components/BlueprintCanvas.tsx`) is a visualization layer compiled from Venice. When Run is pressed, the dashboard calls `/api/agent/run-ai` which runs the Venice ReAct loop independently — the canvas nodes don't constrain tool calls.

### MongoDB for persistence
`src/lib/db/mongodb.ts` — singleton client, DB name `clove`. Collections: `agent_runs`, `agent_positions`, `apy_snapshots`, `workflows`, `schedules`. All writes are fire-and-forget (non-fatal). Functions in `src/lib/agent/memory.ts`.

### ERC-7715 permission
`src/lib/web3/permissions.ts` — `requestUsdcPermission()` calls `walletClient.requestExecutionPermissions()` (MetaMask). Returns `permissionsContext` (hex delegation chain) + `delegationManager`. Regular MetaMask v12+ supports this but returns a near-empty context; MetaMask Flask returns a valid one. Revocation via `DelegationManager.disableDelegation(bytes32)`.

### 1Shot API
`src/lib/oneshot/agentWallet.ts` — server wallet at `0x5fA306c23C731039a998215f3432205Df8A34cF1`. `storeDelegation` → `redelegatePermissionContextOnce` → `executeAsDelegator`. 1Shot handles gas sponsorship.

---

## Environment Variables

```
ONESHOT_API_KEY / ONESHOT_API_SECRET / ONESHOT_BUSINESS_ID / ONESHOT_WALLET_ID
NEXT_PUBLIC_CLOVE_SESSION_ADDRESS   # 1Shot wallet address (public)
VENICE_API_KEY                      # OpenAI-compat key for Venice
MONGODB_URI                         # mongodb+srv://... → DB name hardcoded as "clove"
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
BASE_SEPOLIA_RPC / NEXT_PUBLIC_BASE_SEPOLIA_RPC
CLOVE_PAY_TO_ADDRESS                # x402 fee recipient
TAVILY_API_KEY / FAL_API_KEY / EXA_API_KEY   # optional — skip gracefully if missing
CRON_SECRET                         # Vercel cron auth header
```

---

## API Routes Reference

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/agent/compile` | POST | Venice compiler → workflow JSON; saves to MongoDB if `walletAddress` provided |
| `/api/agent/run-ai` | POST | Venice ReAct agent loop; saves run to MongoDB |
| `/api/agent/run` | POST | Legacy graph-walker executor (uses compiled workflow nodes directly) |
| `/api/agent/cron` | GET | Vercel cron — loads all enabled schedules from MongoDB, runs each |
| `/api/agent/schedule` | POST/GET | Save/load schedule config (MongoDB) |
| `/api/agent/memory/prompt` | GET `?wallet=` | Full memory string for Venice injection |
| `/api/agent/memory/run` | POST | Save a run result to MongoDB |
| `/api/intelligence` | GET | Returns 402 without `PAYMENT-SIGNATURE`; Venice yield data when paid |
| `/api/x402/pay` | POST | Pay for an x402 endpoint using ERC-7715 delegation via 1Shot |
| `/api/x402/store-delegation` | POST | Store ERC-7715 context in 1Shot |
| `/api/execute/defi` | POST | Encode protocol calldata; submit via 1Shot `executeAsDelegator` |
| `/api/notify/telegram` | POST | Send Telegram message via Bot API |
| `/api/session/address` | GET | Returns 1Shot wallet address |

---

## Node Types (Canvas)

`src/lib/aiCompiler.ts` defines `NodeType`. Key ones: `trigger`, `budget`, `intelligence` (Venice x402), `intelligence-tavily`, `risk-check`, `compare-apy`, `sentiment-check`, `defi-lend` (Morpho), `defi-swap` (Uniswap), `defi-stake` (Lido), `defi-save` (Sky), `defi-lp` (Aerodrome), `notify`. Node styles/colors in `src/components/BlueprintCanvas.tsx → NODE_STYLES`.

## Protocol Addresses (Base Sepolia)

Defined in `src/lib/protocols/addresses.ts`. Key: Morpho Blue `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, Morpho Moonwell USDC vault `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca`.

## Important Patterns

- All server-only modules start with `import "server-only"` — never import in client components
- `terminalStore` (`src/lib/walletEmulator.ts`) is the in-memory log ring buffer (200 entries); used for UI feedback only
- `metamaskStore` (`src/lib/web3/metamaskStore.ts`) is a singleton class with listeners — use `addListener()` to subscribe in components
- Venice fallback: if API call fails, compiler falls back to regex (`compilePromptToWorkflow` in `src/lib/aiCompiler.ts`), analyst falls back to randomised data
- `import "server-only"` modules cannot be imported in `"use client"` files — memory, DB, Venice, 1Shot are all server-only
