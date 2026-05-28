# 1Shot Contract Method Setup — Real On-Chain Execution

The CLOVE backend is now wired to use 1Shot's `executeAsDelegator` with:
- `params` matching each method's ABI shape
- `delegationData: [permissionsContext]` for one-time ERC-7715 redemption (no pre-storage)
- USDC approve step before every deposit/swap

The only remaining step is **importing contract methods into the 1Shot dashboard** so each protocol gets a UUID.

---

## Quick path: Start with Morpho only (proves the whole flow with one import)

If you import just **2 methods** (USDC approve + Morpho deposit), you'll get:
- Real on-chain USDC approval tx
- Real on-chain Morpho deposit tx
- A working end-to-end demo proving everything else is plumbing

### Step 1 — Import USDC `approve` (Base mainnet)

In [dashboard.1shotapi.com](https://dashboard.1shotapi.com):

1. **Smart Contracts** → **My Smart Contracts** → **+ Import Smart Contract Methods**
2. Chain: **Base** (8453)
3. Contract Address: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
4. Wallet: **Base** (the one with id `9acdd06d-576e-4576-bbfc-daecd9c1c33f`)
5. Import this method only:
   ```
   approve(address spender, uint256 amount) returns (bool)
   ```
6. Copy the generated UUID.

### Step 2 — Import Morpho vault `deposit`

1. **+ Import Smart Contract Methods**
2. Chain: **Base** (8453)
3. Contract Address: `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca` *(Moonwell Flagship USDC vault)*
4. Wallet: **Base**
5. Import:
   ```
   deposit(uint256 assets, address receiver) returns (uint256)
   ```
6. Copy the UUID.

### Step 3 — Add UUIDs to `.env.local`

Open `D:\github\CLOVE\.env.local` and add:

```
ONESHOT_METHOD_USDC_APPROVE=<paste-uuid-from-step-1>
ONESHOT_METHOD_MORPHO_VAULT_DEPOSIT=<paste-uuid-from-step-2>
```

### Step 4 — Restart `npm run dev`

The new env vars take effect on restart.

### Step 5 — Test

1. Grant ERC-7715 permission to CLOVE (already working)
2. Click **Run** on a Morpho strategy
3. Watch the terminal — you should see:
   ```
   [executeDefi] submitted: true, txHash: 0x...
   ```
4. Click the txHash on basescan.org and watch the real on-chain Morpho deposit happen.

---

## Full path: All 5 protocols

After the Morpho proof works, expand with these. Each follows the same dashboard pattern.

| Action | Contract | Method ABI | env var |
|--------|----------|------------|---------|
| Sky sUSDS deposit | `0x5875eEE11Cf8398102FdAd704C9E96607675467a` | `deposit(uint256 assets, address receiver)` | `ONESHOT_METHOD_SKY_DEPOSIT` |
| Lido wrap stETH→wstETH | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` | `wrap(uint256 _stETHAmount)` | `ONESHOT_METHOD_LIDO_WRAP` |
| Uniswap V3 swap | `0x2626664c2603336E57B271c5C0b26F421741e481` | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `ONESHOT_METHOD_UNISWAP_SWAP_EXACT_INPUT` |
| Aerodrome swap | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | `swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)` | `ONESHOT_METHOD_AERODROME_SWAP_EXACT_TOKENS` |

---

## How to verify the wiring works WITHOUT importing anything

Even before you set any UUID, the code already:
1. Returns `prepared: true` with correct calldata for all 5 protocols
2. Tells you exactly which env var to set:
   ```
   "reason": "Set ONESHOT_METHOD_MORPHO_VAULT_DEPOSIT in .env.local..."
   ```

So you can confirm the code path is good before doing any dashboard work.

```bash
curl -X POST http://localhost:3000/api/execute/defi \
  -H "Content-Type: application/json" \
  -d '{"action":"morpho-vault-deposit","protocol":"morpho","nodeConfig":{"amount":"0.1"},"permissionsContext":"0xREAL_CONTEXT","delegationManager":"0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3","walletAddress":"0xYOUR_WALLET"}'
```

Expected response (before UUIDs set):
```json
{
  "prepared": true,
  "submitted": false,
  "contractAddress": "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
  "functionName": "deposit",
  "calldata": "0x6e553f65...",
  "reason": "Set ONESHOT_METHOD_MORPHO_VAULT_DEPOSIT in .env.local..."
}
```

After UUIDs set:
```json
{
  "submitted": true,
  "txHash": "0xabc...",
  "via": "1shot"
}
```
