<div align="center">

# CLOVE

### Autonomous capital, with budgets it *physically* can't break.

**Grant one capped USDC budget. A Fund Manager AI splits it across specialized agents — each with its own key, its own smart account, and an on-chain budget it cannot exceed. They research, decide, and execute on Base while you sleep. Fully non-custodial. Revocable in one click.**

[![Built on Base](https://img.shields.io/badge/Built%20on-Base%20mainnet-0052FF?style=flat-square)](https://base.org)
[![ERC-7715](https://img.shields.io/badge/Permissions-ERC--7715-C8FF3D?style=flat-square)](https://eips.ethereum.org/EIPS/eip-7715)
[![ERC-7710](https://img.shields.io/badge/Delegation-ERC--7710-C8FF3D?style=flat-square)](https://eips.ethereum.org/EIPS/eip-7710)
[![1Shot Relayer](https://img.shields.io/badge/Gas-1Shot%20Relayer%20(USDC)-9b87f5?style=flat-square)](https://1shotapi.com)
[![Venice AI](https://img.shields.io/badge/AI-Venice-FF5A1F?style=flat-square)](https://venice.ai)

🌐 **Live demo:** _[your-deployed-url]_ · 🎥 **Demo video:** _[link]_ · 🐦 **[@clove_fi_ai](https://x.com/clove_fi_ai)**

_Built for the **MetaMask Smart Accounts Kit × 1Shot API × Venice AI** Dev Cook Off._

</div>

---

## 🏆 The proof — caps enforced on-chain, not in our code

Everyone claims "safe AI agents." We made it **provable on Base mainnet**.

A worker agent was capped at **0.05 USDC**. We told it to move **1.0 USDC** through the 1Shot relayer. The transaction **reverted at the EVM level**:

```
Error(ERC20TransferAmountEnforcer:allowance-exceeded)
```

The cap isn't a database flag or an `if` statement we could forget — it's a **MetaMask caveat enforcer** baked into the delegation. Even if our backend were fully compromised, the worker still couldn't overspend.

**Verify it yourself on-chain:**

- 🔗 **CloveAutoDeposit contract** — every real ERC-7710 redemption + protocol deposit lands here:
  [`0xb7aD6bcCD73db1a21A6144Ecbc9Cc225Dd6AF1dC`](https://basescan.org/address/0xb7aD6bcCD73db1a21A6144Ecbc9Cc225Dd6AF1dC)
- 🔗 **Fund Manager** (delegator, holds the user grant):
  [`0xbF690def68D68E1cF7b643fEEc8E85789dF0C2E1`](https://basescan.org/address/0xbF690def68D68E1cF7b643fEEc8E85789dF0C2E1)
- ▶️ Reproduce in 1 click: open **`/dashboard/proof`** → "Try to overspend" → watch it revert.

> A real `Redeem Delegation` moved **1.8 USDC** into **Moonwell mwUSDC**, gas paid in USDC via the relayer — no ETH anywhere.

---

## The problem

Autonomous DeFi agents force a brutal trade-off:

- **Custodial bots** — you hand over keys (or a permissioned hot wallet). They take fees, get hacked, or drift your strategy.
- **"Trust me" agents** — the budget is enforced by the app's own code. One bug or breach and your wallet is drained.
- **DAOs / vaults** — set-and-forget, but you give up all control of *how* capital is deployed.

**CLOVE is none of these.** Your funds never leave your wallet until a delegation redeems them straight into a protocol. Every agent's spending limit is enforced **by the chain**, not by us.

---

## How it works

```
  YOU
   │  "Rebalance my USDC across Morpho and Aave for the best risk-adjusted
   │   yield. Conservative. 2 USDC. Daily. Telegram me. Multi-agent."
   ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  ONE ERC-7715 GRANT  →  FUND MANAGER  (capped, revocable)          │
  └───────────────┬──────────────────────────────────────────────────┘
                  │  redelegates scoped, ON-CHAIN-CAPPED slices
        ┌─────────┼───────────────┬───────────────┬──────────────────┐
        ▼         ▼               ▼               ▼                  ▼
   Morpho Scout  Aave Scout   Convergence     Risk Monitor      Executor
   (read-only)   (read-only)  Analyzer        (gates risk)      (spends, capped)
        └─────────┴──── shared team memory ────┴───────────────────┘
                                                       │
                                                       ▼
                              1Shot Public Relayer  (gas in USDC, no ETH)
                                                       │
                                                       ▼
                                                 Base mainnet
                                  Morpho · Aave · Uniswap · Aerodrome · Lido
```

- **Derived keys (option C):** every agent gets its own key — `keccak256(rootKey ‖ agentId)` — so it's a genuinely separate signer + smart account. One secret is ever stored.
- **Real ERC-7710 redemption:** the worker's chain `user → Fund Manager → worker → relayer` is redeemed by the permissionless 1Shot relayer. Two caveat enforcers ride along: `AllowedTargetsEnforcer` (where it can call) + `ERC20TransferAmountEnforcer` (how much it can spend).
- **Venice reasons, then acts:** plan → scout live yields → assess risk → check your uploaded playbook (RAG) → execute → reflect.

---

## 🎯 Why CLOVE wins each track

| Track | How CLOVE wins |
|---|---|
| **Best A2A coordination** | A Fund Manager redelegates **real ERC-7710 scoped chains** to worker agents — each with its own key + on-chain-enforced cap. **Overspend reverts on-chain (provable).** Agents coordinate via shared team memory (scout findings feed the analyzer feeds the executor). |
| **Best Agent** | A from-scratch Venice **ReAct loop** (no LangChain) that plans, scouts live yields, reasons against persistent memory **+ the user's uploaded playbook (RAG)**, executes real deposits, and reflects. |
| **Best Venice AI** | **Four** Venice surfaces: reasoning (`llama-3.3-70b`), embeddings (RAG knowledge base), TTS voice reports, and image strategy cards. |
| **Best 1Shot Relayer** | **All** execution flows through the **permissionless Public Relayer** — gas paid in USDC, zero ETH. |
| **Best Social Media** | [@clove_fi_ai](https://x.com/clove_fi_ai) |

---

## Features

### 🏦 Fund Manager → capped worker agents (real A2A)
Describe a strategy and choose "multi-agent." A **Fund Manager** node holds your single grant and splits it into specialized workers — yield scouts, a convergence analyzer, a risk monitor, an executor — each with its **own derived smart account and on-chain budget**.

### 🔐 On-chain-enforced budgets (the headline)
Every worker's delegation carries `AllowedTargetsEnforcer` + `ERC20TransferAmountEnforcer`. It can only call whitelisted protocol contracts, and only up to its cap. **Try to exceed it → the chain reverts.** Proven, not promised.

### 📚 Bring your own playbook (RAG)
Upload your rules ("never touch memecoins · only blue-chip protocols · max 30% per position"). CLOVE embeds them with Venice and injects the most relevant ones into the agent's reasoning before every decision.

### 🤖 Venice ReAct agent (hand-built)
A real plan → act → reflect loop on Venice's OpenAI-compatible API. Watch it think on a live canvas — compact nodes that expand on click, with protocol logos and the real tx + token received.

### 🔄 Real deposits + one-click revocation
Genuine Morpho (Moonwell) / Aave v3 deposits via the `CloveAutoDeposit` contract. Revoke any delegation on-chain from the UI — `DelegationManager.disableDelegation`.

### 🐋 Dune-powered copy-trade
Discover the smartest money on Base via Dune Analytics (whale ranking + convergence), then mirror trades when multiple whales agree.

### 🧠 Persistent memory · 📅 scheduling · 💬 Telegram reports

---

## ✅ What's real vs. what we cut (honesty)

We'd rather ship less and have it be true.

**Real, on-chain (Base mainnet):**
- ERC-7715 grant → ERC-7710 redemption via the 1Shot Public Relayer
- Per-agent on-chain-enforced caps (overspend reverts — verifiable above)
- Morpho (Moonwell) + Aave v3 deposits; on-chain revocation
- Venice reasoning, embeddings/RAG, TTS, image

**Cut:**
- ❌ **x402** — our integration only *simulated* settlement (no USDC actually moved). Rather than fake it, we removed it entirely. Venice intel/TTS/image are now free internal calls.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript, Tailwind |
| Smart accounts | `@metamask/smart-accounts-kit` (ERC-7715/7710, caveat enforcers, `Implementation.Hybrid`) |
| Execution | 1Shot **Public Relayer** (permissionless, gas-in-USDC) on Base |
| AI | Venice AI (OpenAI-compatible): `llama-3.3-70b` + embeddings + `tts-kokoro` + image |
| Onchain | `viem` 2.x · Base mainnet (8453) |
| Analytics | Dune Analytics (whale discovery) |
| Canvas | `@xyflow/react` (compact-by-default nodes, click to expand) |
| Store | MongoDB Atlas |

---

## Supported protocols

**Base (8453):** Morpho (Moonwell USDC) · Aave v3 · Uniswap v3 · Aerodrome · Lido (wstETH)

---

## 60-second demo

1. **Connect** MetaMask (Base) and have a little USDC in your wallet.
2. **New workflow** → *"Rebalance my USDC across Morpho and Aave for the best risk-adjusted yield, conservative, 2 USDC, daily, multi-agent."*
3. Sign the **Fund Manager grant** → toast: *"Team live · N workers on-chain-capped ✓"*. See the **Fund Manager → scouts → analyzer → risk → executor** canvas.
4. **Run agent** → it scans yields, assesses risk, and makes a **real deposit** into Morpho (gas in USDC). The execute node shows the **tx + token received** (e.g. `→ mwUSDC`).
5. **`/dashboard/proof`** → "Try to overspend" → `ERC20TransferAmountEnforcer:allowance-exceeded`. 🎯

---

## Quick start

### Prerequisites
- Node 20+, a MongoDB Atlas URI, a Venice AI key, a MetaMask wallet, a little USDC on Base.

### Install & run
```bash
npm install
npm run dev          # → http://localhost:3000
```

### Environment (`.env.local`)
```bash
# ── AI ────────────────────────────────────────────────
VENICE_API_KEY=...

# ── CLOVE session (root key for the Fund Manager + derived agent keys) ──
CLOVE_SESSION_KEY=0x...                       # session EOA owns the Fund Manager
NEXT_PUBLIC_CLOVE_SESSION_ADDRESS=0x26a5...   # 1Shot relayer target (Base)
CLOVE_INTERNAL_SECRET=...                     # server-to-server auth (replaced x402)
CLOVE_AUTO_DEPOSIT=0xb7aD6bcCD73db1a21A6144Ecbc9Cc225Dd6AF1dC

# ── Chain ─────────────────────────────────────────────
BASE_RPC=https://mainnet.base.org

# ── Store / notify ────────────────────────────────────
MONGODB_URI=mongodb+srv://...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# ── Optional ──────────────────────────────────────────
DUNE_API_KEY=...                              # copy-trade whale discovery
QUICKNODE_ENDPOINT=...                         # ERC-8004 agent registration
CRON_SECRET=...                                # Vercel cron auth
```

---

## How the real A2A delegation works (the crown jewel)

The hard part — and what makes the overspend proof real — is the delegation chain. Three things had to be exactly right (we learned each the hard way):

1. **EOA delegators.** Each hop is signed with a raw key, so the `delegator` address must be that key's **EOA** — a counterfactual smart-account address there throws `InvalidEOASignature()`.
2. **Sanctioned grant path.** Modern MetaMask blocks raw `signDelegation` for its own accounts, so the user→Fund Manager grant goes through ERC-7715 `requestExecutionPermissions` (Advanced Permissions).
3. **Tightly-packed caveat terms.** Enforcer terms are packed bytes (20-byte addresses concatenated), not ABI-encoded — otherwise `AllowedTargetsEnforcer:invalid-terms-length`.

Get all three right and the 1Shot relayer redeems the full `user → Fund Manager → worker → relayer` chain, the `ERC20TransferAmountEnforcer` holds the cap, and overspend reverts. ✅

---

## Roadmap

- Split the Fund Manager budget *across* workers (currently each worker is capped at the team budget)
- Live portfolio view (read on-chain `mwUSDC`/`aBasUSDC` positions + one-click withdraw)
- More protocols (Compound, Fluid) and chains
- Auto-recovery cron for any deposit interrupted mid-run

---

## License

MIT

## Acknowledgments

MetaMask Smart Accounts Kit · 1Shot API (Public Relayer) · Venice AI · Dune Analytics · Base.
