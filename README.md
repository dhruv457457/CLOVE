<div align="center">

# CLOVE

### Autonomous capital, quietly.

**The autonomous DeFi agent OS — describe a strategy in plain English, grant one ERC-7715 budget, and an AI agent researches, decides, and executes onchain. Fully non-custodial.**

[![Built on Base](https://img.shields.io/badge/Built%20on-Base%20mainnet-0052FF?style=flat-square)](https://base.org)
[![ERC-7715](https://img.shields.io/badge/Permissions-ERC--7715-C8FF3D?style=flat-square)](https://eips.ethereum.org/EIPS/eip-7715)
[![x402](https://img.shields.io/badge/Payments-x402-8B6BFF?style=flat-square)](https://x402.org)
[![Venice AI](https://img.shields.io/badge/AI-Venice-FF5A1F?style=flat-square)](https://venice.ai)

</div>

---

## The problem

DeFi forces a brutal trade-off:

- **Manual** — you spend hours every week comparing yields, evaluating risk, and clicking through MetaMask. APY changes overnight. You miss the rebalance. You hold through a hack.
- **Custodial bots** — you hand your private keys (or a permissioned hot wallet) to a third party. They take fees, get hacked, or quietly drift your strategy.
- **DAOs / vaults** — you give up control of how your capital is deployed in exchange for "set and forget." You can't say "rebalance to the highest APY but never touch Aerodrome."

**CLOVE is none of these.** It's a non-custodial agent runtime where:

1. You describe what you want in English.
2. You grant a **recurring USDC budget** via ERC-7715 — capped, time-limited, revocable in one tx.
3. An AI agent runs on a schedule. It pays for live market intel. It reasons against memory of every prior run. It executes through your delegation. It tells you what it did.

You never hand over keys. You never run a bot. The agent thinks before it spends.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  YOU                                                                │
│   │                                                                 │
│   │ "Watch USDC yields, deposit into best safe vault > 8%,         │
│   │  hold otherwise, alert me on Telegram. 10 USDC / 30 days."     │
│   ▼                                                                 │
│  ┌─────────────────────────┐                                       │
│  │  VENICE AI COMPILER     │  Plain English → Workflow JSON         │
│  └────────────┬────────────┘                                       │
│               │                                                     │
│               ▼                                                     │
│  ┌─────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  REACT FLOW CANVAS      │  │  ERC-7715 PERMISSION             │ │
│  │  Visual node graph      │  │  10 USDC / 30 days → CLOVE agent │ │
│  │  Editable per node      │  │  (signed once in MetaMask)       │ │
│  └────────────┬────────────┘  └────────────┬─────────────────────┘ │
│               │                            │                       │
│               └────────┬───────────────────┘                       │
│                        ▼                                           │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  VENICE REACT AGENT LOOP  (runs on Vercel cron)            │    │
│  │                                                            │    │
│  │   checkYields ──► checkRisk ──► executeDefi ──► notifyUser │    │
│  │       │              │              │              │       │    │
│  │       │              │              │              └─► Telegram │
│  │       │              │              └─► 1Shot executeAsDelegator │
│  │       │              └─► Venice analyses news + APY       │    │
│  │       └─► /api/intelligence (x402: pay 0.01 USDC,         │    │
│  │            get yields + market intel from Tavily/Exa/Venice)│    │
│  │                                                            │    │
│  │   ALL decisions read agent memory from MongoDB:            │    │
│  │   - Current position (which protocol, when entered)         │    │
│  │   - Last 5 runs (rebalance? hold? success?)                │    │
│  │   - 7-day APY history (real signal vs noise)                │    │
│  └────────────────────────────────────────────────────────────┘    │
│                        │                                           │
│                        ▼                                           │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  ON-CHAIN EXECUTION (Base mainnet)                         │    │
│  │  1Shot redeems your ERC-7715 delegation → UserOp →          │    │
│  │  DelegationManager.redeemDelegation() → Morpho/Sky/Uniswap │    │
│  │  Returns txHash. Gasless on your side.                     │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Features

### 🧠 Plain-English strategy compiler

Type a sentence. Venice AI compiles it into a visual workflow: trigger → budget → intel → reasoning → execution → notification. Each node is editable in the right panel.

```
"Hourly check, 25 USDC budget, protect from risk, rebalance to best yield, notify Telegram"
```

### 🔐 Non-custodial via ERC-7715

CLOVE never holds your private key. You grant a **recurring USDC allowance** to CLOVE's smart-account wallet (managed by 1Shot). The permission:

- Is **capped** (e.g. 10 USDC every 30 days — never more)
- Is **time-limited** (expires automatically)
- Is **revocable on-chain in one transaction** (DelegationManager.disableDelegation)
- Survives nothing — no private key import, no seed phrase, no allowance set on a sketchy contract

### 💸 x402 paid intelligence

The agent doesn't get free data. Every time it wakes up, it pays **0.01 USDC via x402** to `/api/intelligence`, which aggregates:

- **Venice AI** — risk-adjusted yield reasoning
- **Tavily** — live DeFi news and exploit alerts
- **Exa** — semantic search across protocol docs

This is real demand-driven payment for AI inference — the same pattern that makes the open agentic economy work.

### 🤖 Venice ReAct agent (not LangChain, not Vercel AI SDK)

Custom OpenAI function-calling loop using Venice's `llama-3.3-70b` model. Five tools:

| Tool          | Purpose                                                         |
|---------------|-----------------------------------------------------------------|
| `checkYields` | x402-paid call to intelligence API. Returns APY map + news     |
| `checkRisk`   | Keyword + sentiment scan for exploits, pauses, depegs            |
| `executeDefi` | Calls `/api/execute/defi` → 1Shot → on-chain tx                  |
| `rebalance`   | Withdraw from old protocol + deposit into new (atomic)           |
| `notifyUser`  | Sends Telegram message via Bot API                               |

Venice decides which tools to call and in what order based on memory + market data.

### 🗄️ Persistent memory (MongoDB)

Every run writes to MongoDB Atlas (`clove` DB). The agent reads its full history before deciding:

- **`agent_runs`** — every execution: protocol, action, APY, txHash, cost, Venice reasoning
- **`agent_positions`** — current deployment (one per wallet)
- **`apy_snapshots`** — rolling APY data for trend detection
- **`workflows`** — saved workflow graphs (for cron re-execution)
- **`schedules`** — user-configured triggers

Result: the agent doesn't redo work. If you're already in Morpho at 9.31% and that's still the best APY, it **HOLDs** — no needless gas, no needless x402 fees.

### 🎨 Visual workflow canvas

Built on ReactFlow. Each strategy is a node graph:

- **Drag** to reposition nodes
- **Click** to edit any node's config in the right panel
- **Lime accent** highlights the currently executing node during a run
- **Dashed flowing edges** show data movement
- **Live APY** displayed inside relevant nodes

### 📅 Scheduling

Set a workflow to run **every 5 min / 15 min / 30 min / hourly / 6h / daily / weekly** or paste a custom cron. Schedules are stored in MongoDB; Vercel cron polls `/api/agent/cron` hourly and runs every enabled wallet's saved workflow.

### 💬 Telegram notifications

Every action ends with a Telegram message showing the txHash, protocol, APY, and Venice's reasoning. (Bot: [@clove_erc7715bot](https://t.me/clove_erc7715bot))

---

## Tech stack

| Layer            | Tech                                                                  |
|------------------|-----------------------------------------------------------------------|
| **Frontend**     | Next.js 16 (Turbopack), React 18, ReactFlow, TailwindCSS              |
| **Design**       | Geist + Instrument Serif italic, paper #F4F1EA + ink #0B0C09 + lime #C8FF3D |
| **Wallet**       | MetaMask v12+ (ERC-7715), `@metamask/smart-accounts-kit`              |
| **Server wallet**| 1Shot API (managed smart account, gas sponsorship, delegation redemption) |
| **Payments**     | x402 protocol — HTTP 402 + PAYMENT-SIGNATURE                         |
| **AI**           | Venice AI (OpenAI-compatible, privacy-first) — `llama-3.3-70b` for the agent, `qwen3-5-9b` for compilation |
| **Intelligence** | Tavily (news), Exa (semantic search), fal.ai (visuals) — optional    |
| **Persistence**  | MongoDB Atlas (`clove` DB)                                            |
| **Chain**        | Base mainnet (chainId 8453)                                           |
| **Notifications**| Telegram Bot API                                                      |
| **Scheduling**   | Vercel cron → `/api/agent/cron`                                       |

---

## Supported protocols (Base mainnet)

| Protocol  | Action            | Contract                                                                                          |
|-----------|-------------------|---------------------------------------------------------------------------------------------------|
| **Morpho** (Moonwell USDC vault) | Lend / supply USDC | [`0xc1256Ae5...A2Ca`](https://basescan.org/address/0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca) |
| **Sky** (sUSDS)   | Save / deposit USDC | [`0x5875eEE1...467a`](https://basescan.org/address/0x5875eEE11Cf8398102FdAd704C9E96607675467a) |
| **Lido** (wstETH) | Wrap stETH → wstETH | [`0xc1CBa3fC...e452`](https://basescan.org/address/0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452) |
| **Uniswap V3**    | Swap USDC ↔ WETH    | [`0x2626664c...e481`](https://basescan.org/address/0x2626664c2603336E57B271c5C0b26F421741e481) |
| **Aerodrome**     | Swap / LP            | [`0xcF77a3Ba...4E43`](https://basescan.org/address/0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43) |

---

## Demo flow

1. Open [localhost:3000](http://localhost:3000) → landing page
2. Click **Launch agent** → dashboard
3. In the **Ask clove** sidebar, type: `Hourly check, 0.1 USDC budget, deposit into best Morpho vault, notify Telegram`
4. Workflow appears on canvas: `Trigger → Budget → Venice (x402) → Compare → Execute → Notify`
5. **Right panel → Permission tab** → Click **Grant ERC-7715 Permission** → MetaMask popup → Confirm
6. **Schedule tab** → Set "Every hour" → Enable → Save
7. Hit the lime **Run** button (top-right) — or wait for cron
8. Watch the canvas: each node lights lime as Venice executes it
9. **Bottom log strip** streams each tool call in real time
10. ✅ Telegram message arrives with the on-chain txHash
11. Click the txHash → opens [basescan.org](https://basescan.org) showing your real Morpho deposit

Run again immediately — Venice reads memory, sees you're already in Morpho at the best APY, and says **HOLD**. No tx, no fees. That's the loop working.

---

## Quick start (local development)

### Prerequisites

- Node.js 20+
- npm or pnpm
- A MetaMask wallet on **Base mainnet** with ≥ 0.1 USDC
- API keys (see Environment below)

### Install & run

```bash
git clone https://github.com/your-org/CLOVE.git
cd CLOVE
npm install
cp .env.example .env.local   # then fill in keys
npm run dev
# → http://localhost:3000
```

### Environment variables

Create `.env.local` from `.env.example` and fill these in:

```bash
# ── 1Shot API (managed server wallet on Base mainnet) ─────
ONESHOT_API_KEY=         # dashboard.1shotapi.com → API Keys
ONESHOT_API_SECRET=
ONESHOT_BUSINESS_ID=
ONESHOT_WALLET_ID=       # the wallet on chainId 8453
NEXT_PUBLIC_CLOVE_SESSION_ADDRESS=   # public — wallet address shown to users

# ── Contract Method UUIDs (from 1Shot dashboard) ──────────
# See ONESHOT_SETUP.md for import instructions
ONESHOT_METHOD_USDC_APPROVE=
ONESHOT_METHOD_MORPHO_VAULT_DEPOSIT=
ONESHOT_METHOD_SKY_DEPOSIT=
ONESHOT_METHOD_LIDO_WRAP=
ONESHOT_METHOD_UNISWAP_SWAP_EXACT_INPUT=
ONESHOT_METHOD_AERODROME_SWAP_EXACT_TOKENS=

# ── Venice AI (OpenAI-compatible) ─────────────────────────
VENICE_API_KEY=

# ── MongoDB Atlas ─────────────────────────────────────────
MONGODB_URI=mongodb+srv://...   # free cluster → DB name hardcoded as "clove"

# ── Telegram ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── Network ───────────────────────────────────────────────
BASE_RPC=https://mainnet.base.org

# ── x402 fee recipient ────────────────────────────────────
CLOVE_PAY_TO_ADDRESS=    # wallet that receives intelligence API fees

# ── Vercel cron auth ──────────────────────────────────────
CRON_SECRET=

# ── Optional intelligence sources (graceful skip if missing) ──
TAVILY_API_KEY=
FAL_API_KEY=
EXA_API_KEY=
```

### Commands

```bash
npm run dev      # Start dev server (Turbopack, localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
npx tsc --noEmit # Type-check (run this after every change)
```

---

## Project structure

```
src/
├── app/
│   ├── page.tsx                  # Landing (paper / editorial design)
│   ├── dashboard/page.tsx        # Main workflow builder (ink / lime)
│   ├── marketplace/page.tsx      # Strategy marketplace (placeholder)
│   ├── globals.css               # Design tokens + ReactFlow overrides
│   ├── layout.tsx                # Fonts (Geist + Instrument Serif)
│   └── api/
│       ├── agent/
│       │   ├── compile/route.ts        # Venice AI compiler → workflow JSON
│       │   ├── run-ai/route.ts         # Venice ReAct agent execution
│       │   ├── cron/route.ts           # Vercel cron entrypoint
│       │   ├── schedule/route.ts       # Save/load schedules
│       │   └── memory/
│       │       ├── prompt/route.ts     # Memory string for Venice injection
│       │       └── run/route.ts        # Save a run result
│       ├── intelligence/route.ts       # x402-gated yield + news endpoint
│       ├── x402/
│       │   ├── pay/route.ts            # x402 payment with delegation redelegation
│       │   └── store-delegation/route.ts
│       ├── execute/defi/route.ts       # Encode + submit DeFi calls via 1Shot
│       ├── notify/telegram/route.ts    # Telegram Bot API
│       └── session/address/route.ts
├── components/
│   ├── BlueprintCanvas.tsx       # ReactFlow workflow canvas
│   ├── EmulatorPanel.tsx         # Grant / Revoke ERC-7715 (right panel)
│   ├── ProtocolSidebar.tsx       # Browseable protocol list
│   ├── ScheduleManager.tsx       # Cron / interval picker
│   ├── RunsHistory.tsx           # Past agent runs
│   └── WorkflowCodeViewer.tsx    # Live TypeScript code preview
├── lib/
│   ├── agent/
│   │   ├── clove-agent.ts        # Venice ReAct loop (OpenAI function calling)
│   │   └── memory.ts             # MongoDB CRUD + buildMemoryPrompt()
│   ├── aiCompiler.ts             # Local regex-based workflow compiler (fallback)
│   ├── db/mongodb.ts             # Singleton MongoDB client
│   ├── oneshot/
│   │   ├── client.ts             # 1Shot SDK init
│   │   └── agentWallet.ts        # Wallet lookup + delegation helpers
│   ├── venice/
│   │   ├── client.ts             # Venice OpenAI client
│   │   └── analyst.ts            # Yield analysis prompts
│   ├── tavily/client.ts          # Tavily news/yield search
│   ├── exa/client.ts             # Exa semantic search
│   ├── protocols/
│   │   ├── addresses.ts          # All Base mainnet contracts
│   │   ├── actions.ts            # Protocol metadata + UI tokens
│   │   └── logos.ts              # Protocol logo URLs
│   └── web3/
│       ├── config.ts             # Chain + USDC
│       ├── permissions.ts        # ERC-7715 grant / revoke
│       ├── metamaskStore.ts      # MetaMask state singleton
│       └── serverSession.ts      # Server-side smart account
└── ...
```

---

## API reference

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/agent/compile`        | POST | Venice compiler → workflow JSON; saves to MongoDB if `walletAddress` provided |
| `/api/agent/run-ai`         | POST | Venice ReAct agent execution; saves run to MongoDB |
| `/api/agent/cron`           | GET  | Vercel cron — loads all enabled schedules, runs each |
| `/api/agent/schedule`       | POST/GET | Save/load schedule config |
| `/api/agent/memory/prompt`  | GET `?wallet=` | Full memory string for Venice injection |
| `/api/agent/memory/run`     | POST | Save a run result |
| `/api/intelligence`         | GET  | Returns 402 without `PAYMENT-SIGNATURE`; Venice yield data when paid |
| `/api/x402/pay`             | POST | Pay for an x402 endpoint using ERC-7715 delegation via 1Shot |
| `/api/x402/store-delegation`| POST | Store ERC-7715 context in 1Shot |
| `/api/execute/defi`         | POST | Encode protocol calldata; submit via 1Shot `executeAsDelegator` |
| `/api/notify/telegram`      | POST | Send Telegram message via Bot API |
| `/api/session/address`      | GET  | Returns the 1Shot wallet address |

---

## Design system

CLOVE rejects the standard "dark-mode DeFi #1,247" aesthetic. The design is **quiet luxury**:

- **Paper `#F4F1EA`** on the marketing site — most DeFi is dark, we flip it
- **Ink `#0B0C09`** on the app — calm, focused, no terminal cosplay
- **Acid lime `#C8FF3D`** — one electric jolt per viewport, used like a highlighter
- **Geist** (sans, multiple weights) + **Instrument Serif italic** (editorial tension on one keyword per heading)
- All transitions use the brand easing: `cubic-bezier(.2, .8, .2, 1)`

Motion-rich landing page: H1 word-by-word reveal, typewriter prompt, cursor-tracked bloom, rotating active node in hero canvas, agent scrollytelling orb with 5 states (rest → scout → reason → execute → report), 3D-tilted dashboard preview with flowing edges, count-up metrics, infinite protocol marquee.

See `src/app/page.tsx` for the implementation.

---

## What CLOVE is **not**

- ❌ **Not a custodial bot** — CLOVE never holds your keys. ERC-7715 is the only path in, revocable in one tx.
- ❌ **Not a vault** — your funds stay in your wallet until the agent moves them via your delegated permission.
- ❌ **Not a yield aggregator** — CLOVE doesn't pool your capital with other users. Every wallet runs an isolated agent.
- ❌ **Not "set and forget"** — the agent runs on your schedule, reports every action, and shows you exactly why. You can revoke any time.

---

## Roadmap

- [x] Plain-English workflow compiler (Venice AI)
- [x] Visual canvas + node editor
- [x] ERC-7715 grant + on-chain revocation
- [x] x402 paid intelligence API
- [x] Venice ReAct agent loop
- [x] MongoDB agent memory
- [x] 1Shot `executeAsDelegator` integration
- [x] Real on-chain Morpho deposit (USDC approve + vault deposit)
- [x] Telegram notifications
- [x] Scheduling (Vercel cron + local 15s poll)
- [ ] Real on-chain Sky, Lido, Uniswap, Aerodrome execution (UUIDs configured)
- [ ] Strategy marketplace (browse + clone other users' strategies)
- [ ] Performance analytics (PnL, gas spent, x402 cost over time)
- [ ] Earnings dashboard for strategy authors
- [ ] Multi-chain support (Optimism, Arbitrum)
- [ ] Mobile responsive layout
- [ ] Anthropic Claude as alternate agent model

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built for the **ETHGlobal Open Agents Hackathon** (April 24 – May 6, 2026).

Powered by:
- [MetaMask Delegation Framework](https://github.com/MetaMask/delegation-framework) (ERC-7715 / ERC-7710)
- [1Shot API](https://1shotapi.com) (managed smart account + bundler)
- [Venice AI](https://venice.ai) (OpenAI-compatible, privacy-first LLM)
- [x402 protocol](https://x402.org) (HTTP-native AI payments)
- [Base](https://base.org) (the chain)
- [MongoDB Atlas](https://www.mongodb.com/atlas) (free cluster works)
- [Vercel](https://vercel.com) (deploy + cron)
- [ReactFlow](https://reactflow.dev) (visual canvas)

---

<div align="center">

**CLOVE — Autonomous capital, quietly.**

[Live demo](https://clove.vercel.app) · [Documentation](./TESTING.md) · [Twitter](https://twitter.com/clove_agent)

</div>
