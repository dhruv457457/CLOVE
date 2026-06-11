/**
 * 1Shot API diagnostic — finds WHICH calls fail and WHY.
 * Run: node --env-file=.env.local scripts/diag-1shot.mjs
 *
 * Read-only: gets an OAuth token, lists wallets + methods, and checks whether
 * the configured ONESHOT_WALLET_ID / ONESHOT_METHOD_* IDs actually exist in the
 * account. Then probes the two failing endpoints with a minimal payload to
 * capture the exact request/response (these 404 harmlessly, no spend).
 */
const BASE = "https://api.1shotapi.com/v0";
const key    = process.env.ONESHOT_API_KEY;
const secret = process.env.ONESHOT_API_SECRET;
const biz    = process.env.ONESHOT_BUSINESS_ID;
const wallet = process.env.ONESHOT_WALLET_ID;

const methodEnvs = Object.keys(process.env).filter(k => k.startsWith("ONESHOT_METHOD_"));

function short(s) { return s ? `${s.slice(0, 8)}…${s.slice(-4)}` : "(unset)"; }
const line = (l) => console.log(l);

async function main() {
  line(`config: key=${short(key)} business=${short(biz)} wallet=${wallet ?? "(unset)"}`);
  line(`method env vars: ${methodEnvs.length}`);
  if (!key || !secret) { line("✗ ONESHOT_API_KEY/SECRET missing"); return; }

  // 1) OAuth token
  line("\n— 1) POST /token (client_credentials)");
  let token;
  try {
    const r = await fetch(`${BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: key, client_secret: secret }),
    });
    const txt = await r.text();
    line(`   status ${r.status}`);
    if (!r.ok) { line(`   body: ${txt.slice(0, 300)}`); return; }
    token = JSON.parse(txt).access_token;
    line(`   ✓ token acquired (${short(token)})`);
  } catch (e) { line(`   ✗ ${e.message}`); return; }

  const auth = { Authorization: `Bearer ${token}` };

  // 2) List wallets for the business — does ONESHOT_WALLET_ID exist?
  line(`\n— 2) GET /business/${short(biz)}/wallets`);
  try {
    const r = await fetch(`${BASE}/business/${biz}/wallets?pageSize=50`, { headers: auth });
    const txt = await r.text();
    line(`   status ${r.status}`);
    if (r.ok) {
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : (data.response ?? data.wallets ?? []);
      line(`   wallets in account: ${arr.length}`);
      arr.slice(0, 10).forEach(w => line(`     - ${w.id}  ${w.accountAddress ?? w.address ?? ""}  chain=${w.chainId ?? w.chain ?? "?"}`));
      const found = arr.find(w => w.id === wallet);
      line(`   configured wallet ${wallet} → ${found ? "✓ EXISTS" : "✗ NOT FOUND in account"}`);
    } else {
      line(`   body: ${txt.slice(0, 300)}`);
    }
  } catch (e) { line(`   ✗ ${e.message}`); }

  // 3) List methods — do the ONESHOT_METHOD_* IDs exist?
  line(`\n— 3) GET /business/${short(biz)}/methods`);
  try {
    const r = await fetch(`${BASE}/business/${biz}/methods?pageSize=50`, { headers: auth });
    const txt = await r.text();
    line(`   status ${r.status}`);
    if (r.ok) {
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : (data.response ?? data.methods ?? []);
      line(`   methods in account: ${arr.length}`);
      const ids = new Set(arr.map(m => m.id));
      for (const env of methodEnvs) {
        const id = process.env[env];
        line(`     ${env}=${id} → ${ids.has(id) ? "✓ exists" : "✗ NOT FOUND"}`);
      }
    } else {
      line(`   body: ${txt.slice(0, 300)}`);
    }
  } catch (e) { line(`   ✗ ${e.message}`); }

  // 4) Probe the two failing endpoints (minimal payload → 404s without spending)
  line(`\n— 4) POST /wallets/${wallet}/redelegate-with-delegation-data (probe)`);
  try {
    const r = await fetch(`${BASE}/wallets/${wallet}/redelegate-with-delegation-data`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ delegationData: "0x00", delegateAddress: "0x0000000000000000000000000000000000000001" }),
    });
    line(`   status ${r.status}`);
    line(`   body: ${(await r.text()).slice(0, 400)}`);
  } catch (e) { line(`   ✗ ${e.message}`); }

  const probeMethod = process.env.ONESHOT_METHOD_UNISWAP_SWAP_EXACT_INPUT ?? process.env[methodEnvs[0]];
  line(`\n— 5) POST /methods/${probeMethod}/execute-as-delegator (probe)`);
  try {
    const r = await fetch(`${BASE}/methods/${probeMethod}/execute-as-delegator`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ params: {}, walletId: wallet, memo: "diag", delegationData: ["0x00"] }),
    });
    line(`   status ${r.status}`);
    line(`   body: ${(await r.text()).slice(0, 400)}`);
  } catch (e) { line(`   ✗ ${e.message}`); }
}

main().catch(e => console.error("DIAG ERROR:", e));
