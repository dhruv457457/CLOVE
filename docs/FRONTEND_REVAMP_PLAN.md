# CLOVE Frontend Revamp — Plan & Context

> Hand-off doc for a fresh Claude Code session. Read this top-to-bottom first, then
> verify every file path against the live tree before editing (this doc may drift).
>
> **§3 pointers verified 2026-06-13.** Two were stale and are now corrected: there is no
> `BlueprintCanvas.tsx`/`NODE_STYLES` (canvas is inline in `dashboard/page.tsx`), and no
> `compile`/`run-ai`/`run` routes (creation is `from-answers` + `questions`). ⚠️ **CLAUDE.md is
> also stale** — it still references `src/lib/aiCompiler.ts` and the removed `compile`/`run-ai`/
> `run` routes; trust THIS doc over CLAUDE.md for the dashboard/create surfaces.

---

## 0. What CLOVE is (60-second context)

Autonomous DeFi agent OS on **Base mainnet** (chainId 8453). User describes a strategy
in English → Venice AI compiles it → a **team of agents** executes it autonomously using
a delegated, on-chain-capped USDC budget (ERC-7715 grant → ERC-7710 scoped redelegation →
1Shot public relayer sponsors gas in USDC).

**Proven working today (do not break):**
- Multi-agent yield team: Scouts → Convergence Analyzer → Risk Monitor → Executors, each
  with its own on-chain `ERC20TransferAmountEnforcer` cap. Lands real Basescan txs.
- Solo copy-trade agent: discovers smart-money convergence → mirrors the swap on-chain.
- Telegram bot: wallet-linked 1:1 control (`/agents`, `/run`, `/tx`, `/create`, natural language).
- Internal scheduler (`src/instrumentation.ts`) ticks `/api/agent/cron` every 60s on Railway.

**Hard constraints:**
- Next.js 16 + Turbopack + React 19. APIs differ from Next 13/14 — read `node_modules/next/dist/docs/` before framework-level code.
- `import "server-only"` modules (memory, DB, Venice, 1Shot, telegram store) **cannot** be imported in `"use client"` files. Chat UI must talk to them via API routes.
- Run `npx tsc --noEmit` after every change. No test runner.

---

## 1. The vision (what the user wants)

Move CLOVE from "blank canvas you must figure out" to **chat-first, like ChatGPT/Claude**:

1. **Chat is the home surface.** When there's no workflow, instead of the empty "Create your
   first workflow" state, show a **conversational prompt bar + chat thread**. The user can ask
   "what is CLOVE?", "what can I do here?", "explain the prompt bar" — and only *create* an
   agent when they decide to.
2. **Conversational create.** The chat gathers intent, the AI **confirms** ("I'll spin up a
   3-agent yield team, $1.2 budget, every 5 min, Telegram reports — confirm?"), and on confirm
   the **node/canvas interface appears** while the **chat persists on the left** (reuse the
   existing left rail real estate).
3. **Memory-backed.** Chat remembers prior turns using the existing memory layer as context,
   **shared between web and Telegram** (same wallet = same conversational memory).
4. **First-run onboarding.** First wallet connect → guided flow: connect Telegram, explain what
   CLOVE does, point at the prompt bar, show example prompts.
5. **Polish:** remove the top **Scan** button, add a real **loading animation**, and **component
   transition effects**.
6. **Surface the on-chain agent role** (see §2) so agents visibly *are* on-chain.

---

## 2. Make agents visibly on-chain (feature, not removal)

**Background (confirmed):** each agent has a derived EOA = its "delegate signer". In the chain
`user → session EOA → agent EOA (capped) → relayer target (0x26a5…)`, the agent EOA signs its
hop and its USDC cap is enforced on-chain against that address. The tx `from` is the 1Shot
relayer (gas sponsor), so the agent address is in the redemption calldata, not the tx top line.

**Do:** Don't remove agent wallets. Surface their on-chain role:
- In the agent panel, **decode the stored `delegationContext`** and render the chain visually:
  `user → session → THIS AGENT (cap X USDC) → relayer`, with the **scoped delegation hash**
  linked to Basescan / the DelegationManager.
- On each executed tx row, **label which agent's delegation authorized it** (match by scoped hash).
- Badge the **Fund Manager** as "Custodian — holds grant, splits budget, never trades" so it
  doesn't look broken when it doesn't run.
- (Optional, stronger proof) emit a log/event carrying the agent EOA on execution for direct
  on-chain attribution. Decoder util: `decodeDelegations` from `@metamask/smart-accounts-kit/utils`
  (already used in `src/lib/web3/subDelegation.ts` and `src/lib/oneshot/publicRelayer.ts`).

---

## 3. Key files (verify before editing)

| Area | File | Notes |
|---|---|---|
| Dashboard shell | `src/app/dashboard/page.tsx` | ⚠️ ONE big client component (~3,095 lines). Top bar (Run Team / Scan@L1170 / Permission / Session / Telegram / Connect). Canvas, all modals, and `EmptyState`@L2880 are inline here. |
| Canvas | **inline in `dashboard/page.tsx`** | ❌ No `BlueprintCanvas.tsx` / `NODE_STYLES`. Uses `@xyflow/react` with inline `AgentNode` (`NODE_TYPES = { agent: AgentNode }`@L380). Colors are local design tokens: `ACCENT = #C8FF3D`, `INK`, etc. |
| Agent node (sub-route only) | `src/components/AgentThoughtNode.tsx` | Exists (505 lines) but only imported by `dashboard/agent/[id]/page.tsx` — NOT the main canvas. |
| Workflow view | `src/app/dashboard/workflow/[id]/page.tsx` | `CopyDeskView`@L675; orchestrated A2A timeline via `/api/workflow/[id]/orchestrate`. |
| MetaMask state | `src/lib/web3/metamaskStore.ts` | singleton + `addListener()` |
| Create flow (Venice) | `src/app/api/agent/from-answers/route.ts` + `questions` | ❌ No `compile` / `run-ai` / `run` routes anymore. `from-answers` (+ the questionnaire `questions` route) builds agents + scoped delegation chains. |
| Create from chat | `src/app/api/agent/from-answers/route.ts` | builds agents + scoped delegation chains |
| Agent run | `src/app/api/agent/run-stream/route.ts` | Plan → execute → reflect loop (`planner.ts` + `tools.ts`), SSE stream — NOT a ReAct loop |
| Memory | `src/lib/agent/memory.ts` | run history, positions, APY snapshots (server-only) |
| Telegram intent | `src/lib/telegram/intent.ts` | natural-language parser to reuse for web chat |
| Telegram store | `src/lib/telegram/store.ts` | wallet↔chat link, Mongo-backed |

**New surfaces likely needed:**
- `POST /api/chat` — server route: takes message + wallet, pulls memory context, calls Venice,
  returns assistant reply + optional structured "proposed agent" payload. (server-only safe)
- `src/lib/chat/` — conversation store (Mongo collection `chat_threads`, wallet-scoped) so web
  + Telegram share one thread per wallet.
- `src/components/ChatPanel.tsx` (`"use client"`) — the thread + prompt bar; talks to `/api/chat`.

---

## 4. Phased plan (each phase ships independently, tsc-clean)

### Phase 0 — Land pending fixes (do first)
There are uncommitted fixes from the prior session (single-agent relayer chain in
`from-answers`, fuzzy name matching + loopback self-calls in the telegram webhook, URL
validation in `publicRelayer`, `vercel.json` cron de-dupe). Commit + push so the new work
starts from a clean, deployed baseline.

### Phase 1 — Chat shell + prompt bar (no create yet)
- Build `ChatPanel.tsx` + `/api/chat` + `chat_threads` Mongo store.
- Replace the empty "Create your first workflow" state with the chat surface.
- Wire Venice for Q&A ("what is CLOVE", "what can I do") using a system prompt that knows
  CLOVE's capabilities. Persist turns per wallet.
- **Acceptance:** user can chat with CLOVE about itself; thread survives reload; no agent created.

### Phase 2 — Conversational create → canvas
- Teach `/api/chat` to detect create intent and return a **proposed plan**. There is no
  `compile` route anymore — reuse the **`from-answers` + questionnaire `questions`** semantics
  (that's what derives agent topology + budgets today). Render an in-chat **confirmation card**
  ("3 agents, $1.2, every 5 min — Confirm").
- On confirm → call `from-answers` → canvas/nodes mount; **chat moves to the left rail** and
  keeps streaming agent activity.
- **Acceptance:** "make me a yield team, $1.2, every 5 min" → confirm → real team created;
  chat stays docked left and shows run events.

### Phase 3 — Shared memory (web ↔ Telegram)
- `chat_threads` keyed by wallet; Telegram webhook + web both read/write the same thread.
- Inject recent thread + `memory.ts` context into every Venice call.
- **Acceptance:** ask something on web, see continuity on Telegram (same wallet), and vice versa.

### Phase 4 — First-run onboarding
- Detect first connect (no agents, no chat history). Guided steps: connect wallet →
  connect Telegram (reuse link-token deep link) → "here's the prompt bar" → example prompts.
- **Acceptance:** brand-new wallet is walked from zero to first prompt without confusion.

### Phase 5 — Remove Scan button
- Delete the top-bar **Scan** action in `dashboard/page.tsx` (and any dead handler).

### Phase 6 — Loading + transitions
- A branded loading animation (skeleton + the clove mark) for chat/canvas/agent-panel fetches.
- Mount/unmount transitions for nodes and the chat→canvas handoff (framer-motion already common
  in this stack; confirm it's installed before adding).

### Phase 7 — On-chain agent role surfacing (see §2)
- Decode + render delegation chain per agent; label txs by authorizing agent; badge Fund Manager.

---

## 5. Design guidance
- **Don't redesign the canvas** — it's the demo centerpiece and it works. It lives **inline in
  `dashboard/page.tsx`** (inline `AgentNode`, `@xyflow/react`), not a `BlueprintCanvas` component.
  The revamp wraps it: chat is the new front door; canvas is what you land on after confirming.
  Beware — `page.tsx` is ~3,095 lines and holds the canvas + every modal; extract carefully.
- **Reuse, don't rebuild:** `intent.ts` already parses natural language; `from-answers` already
  builds agents; `memory.ts` already stores context; the Telegram link flow already works.
- **Keep server-only boundaries:** all Venice/Mongo/1Shot calls behind `/api/*`. The chat panel
  is a thin client.
- **Match the existing aesthetic via the inline design tokens** (`ACCENT = #C8FF3D`, `INK`, dark
  theme) in `dashboard/page.tsx` — there is no `NODE_STYLES` map.

---

## 6. Kickoff prompts for the new session (paste one at a time)

1. **Orient:**
   > Read `docs/FRONTEND_REVAMP_PLAN.md` and `CLAUDE.md`, then explore `src/app/dashboard/page.tsx`
   > (the canvas + all modals live inline here — there is no `BlueprintCanvas.tsx`) and
   > `src/lib/agent/memory.ts`. Summarize the current dashboard structure and confirm the plan's
   > file pointers are still accurate. Don't write code yet.

2. **Phase 0:**
   > Commit and push the pending fixes (from-answers single-agent chain, telegram webhook fuzzy
   > match + loopback, publicRelayer URL validation, vercel.json cron de-dupe) on a branch, then
   > confirm `npx tsc --noEmit` is clean.

3. **Phase 1:**
   > Implement Phase 1 from the plan: a `chat_threads` Mongo store, a `POST /api/chat` route that
   > pulls memory context and calls Venice for Q&A, and a `ChatPanel.tsx` client component that
   > replaces the empty dashboard state. Keep all server-only modules behind the API route. tsc-clean.

4. **Phase 2+:** proceed phase by phase, asking me to confirm the UX at each acceptance check.

---

## 7. Open decisions for the user
- Chat framework: build lightweight in-house (recommended — fewer deps, matches the SSE you
  already use in `run-stream`) vs. a chat library.
- Persistence scope: one thread per wallet (recommended) vs. multiple named threads.
- Onboarding gating: hard wizard vs. dismissible hints (recommended: dismissible).
