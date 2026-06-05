# Whale Discovery — Copy-Trader Teams

CLOVE copy-trader teams support two modes, auto-selected by your prompt:

| Mode | Trigger | What happens |
|------|---------|--------------|
| **Manual** | Prompt contains `0x…` wallet addresses | One scout per wallet tracks it via `checkWhaleTrades` |
| **Discovery** | No addresses in the prompt | A single **Whale Discovery Scout** finds wallets itself via `discoverWhales` |

In discovery mode, `discoverWhales` calls `GET /api/whale/discover`, which uses
**two Dune queries**:

1. **Ranking query** (`DUNE_WHALE_QUERY_ID`) — ranks Base wallets by 30-day volume
   / PnL. Finds genuine **alpha** traders (wallets that move/make the most money).
2. **Convergence query** (`DUNE_CONVERGENCE_QUERY_ID`) — the actual **signal**:
   tokens that 2+ of those top whales bought in the last few days.

> ⚠️ **Why not Basescan/Etherscan?** Etherscan V2's **free tier does not cover
> Base** (`"Free API access is not supported for this chain"`). So per-wallet
> trade reads on Base require a paid Etherscan plan. Dune covers Base on the free
> tier, so CLOVE does **all** whale data (discovery + convergence) in Dune. The
> Basescan path remains only as a best-effort fallback for users on a paid plan.

## Configuration

In `.env.local`:

```bash
# Smart-money data via Dune (Base-friendly, free tier)
DUNE_API_KEY=your_dune_key            # dune.com → Settings → API
DUNE_WHALE_QUERY_ID=7661358           # ranking query (top wallets)
DUNE_CONVERGENCE_QUERY_ID=7661403     # convergence query (the copy signal)

# Optional paid fallback (Etherscan V2 free does NOT cover Base)
BASESCAN_API_KEY=                     # only useful on a paid Etherscan plan
```

`DUNE_API_KEY` alone is **not enough** — Dune runs *queries*, so each query below
must be created and its numeric ID pasted into the matching env var. Both queries
can be created via the Dune API (`POST /api/v1/query`) or the Dune web UI.

## Creating the Dune query

1. Go to **dune.com → New query**.
2. Paste one of the SQL queries below.
3. Run it, then **Save**. The query ID is in the URL: `dune.com/queries/<ID>`.
4. Put `<ID>` into `DUNE_WHALE_QUERY_ID` and restart the dev server.

The discovery route reads **any column that looks like a `0x…` address** as the
wallet, and optionally picks up `pnl` / `winrate` / `trades` columns for display.

### Query A — high-volume Base traders (reliable, low credit)

```sql
SELECT
  taker            AS wallet,
  COUNT(*)         AS trades,
  SUM(amount_usd)  AS volume_usd
FROM dex.trades
WHERE blockchain = 'base'
  AND block_time > now() - interval '30' day
  AND amount_usd > 1000
GROUP BY taker
HAVING COUNT(*) BETWEEN 5 AND 2000      -- exclude bots / one-offs
ORDER BY volume_usd DESC
LIMIT 50
```

### Query B — approximate realized PnL (closer to "alpha", heavier)

```sql
WITH flows AS (
  SELECT
    taker AS wallet,
    SUM(CASE WHEN token_sold_address  IN (
        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,  -- USDC
        0x4200000000000000000000000000000000000006   -- WETH
      ) THEN -amount_usd ELSE 0 END)                       AS spent_usd,
    SUM(CASE WHEN token_bought_address IN (
        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,
        0x4200000000000000000000000000000000000006
      ) THEN amount_usd ELSE 0 END)                        AS realized_usd,
    COUNT(*)                                               AS trades
  FROM dex.trades
  WHERE blockchain = 'base'
    AND block_time > now() - interval '30' day
  GROUP BY taker
)
SELECT
  wallet,
  (realized_usd + spent_usd) AS pnl_usd,   -- rough net of stable/ETH legs
  trades
FROM flows
WHERE trades BETWEEN 5 AND 2000
ORDER BY pnl_usd DESC
LIMIT 50
```

> Query B is a heuristic, not accounting-grade PnL (true PnL needs FIFO lot
> matching across every token). It's good enough to surface consistently
> profitable wallets for a copy-trade demo. For production-grade smart-money
> labels, layer in Nansen/Arkham.

### Query C — convergence signal (`DUNE_CONVERGENCE_QUERY_ID`)

Tokens that 2+ of the top whales bought in the last 3 days — this is the actual
copy-trade trigger. Returns columns `symbol`, `whale_count`, `total_usd`.

```sql
WITH top_wallets AS (
  SELECT taker
  FROM dex.trades
  WHERE blockchain = 'base'
    AND block_time > now() - interval '30' day
    AND amount_usd > 1000
  GROUP BY taker
  HAVING COUNT(*) BETWEEN 5 AND 2000
  ORDER BY SUM(amount_usd) DESC
  LIMIT 40
)
SELECT
  t.token_bought_symbol      AS symbol,
  COUNT(DISTINCT t.taker)    AS whale_count,
  SUM(t.amount_usd)          AS total_usd,
  MAX(t.block_time)          AS last_buy
FROM dex.trades t
JOIN top_wallets w ON t.taker = w.taker
WHERE t.blockchain = 'base'
  AND t.block_time > now() - interval '3' day
  AND t.amount_usd > 300
  AND t.token_bought_symbol IS NOT NULL
  AND t.token_bought_symbol NOT IN ('USDC','USDbC','WETH','DAI','USDT','cbETH','wstETH')
GROUP BY t.token_bought_symbol
HAVING COUNT(DISTINCT t.taker) >= 2
ORDER BY whale_count DESC, total_usd DESC
LIMIT 20
```

Dune caches the last execution; the route reads `/results` (fast). To keep the
signal live, CLOVE refreshes it two ways:

- **On-demand (default)** — `/api/whale/discover` returns `signalAgeMinutes`; when
  the cached signal is older than 10 min it fires a background refresh of
  `/api/whale/refresh`. No cron needed, works on any Vercel plan and in local dev.
- **`GET /api/whale/refresh`** — re-executes both Dune queries. Call it from an
  external scheduler (cron-job.org / GitHub Actions) for a steady cadence.
  Not added to `vercel.json` because Vercel **Hobby** only allows daily crons.

## How a run looks

```
Whale Discovery Scout  →  discoverWhales (Dune: top PnL wallets on Base)
        │                  + live trades + convergence
        ▼
Convergence Detector   →  token bought by 2+ alpha wallets in the window
        ▼
Risk Monitor           →  liquidity / scam gate
        ▼
Copy-Trade Executor    →  executeCopyTrade (mirror swap) + Telegram report
```
