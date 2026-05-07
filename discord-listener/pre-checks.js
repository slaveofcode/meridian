/**
 * meridian Discord signal pre-check pipeline
 * Stages: dedup → blacklist → pool resolution → rug check → deployer check → fees check
 *
 * Each stage returns { pass: true } or { pass: false, reason: "..." }
 * runPreChecks() runs all stages sequentially and stops on first failure.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Config thresholds (synced with user-config.json) ────────────────
function readConfigMinFees() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "user-config.json"), "utf8"));
    return cfg.screening?.minTokenFeesSol ?? cfg.minTokenFeesSol ?? 30;
  } catch { return 30; }
}

function readBlacklistedMints() {
  const file = path.join(ROOT, "token-blacklist.json");
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function readBlockedDeployers() {
  const file = path.join(ROOT, "deployer-blacklist.json");
  if (!fs.existsSync(file)) return { addresses: [] };
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { addresses: [] }; }
}

// ─── Stage 1: Dedup (in-memory, 10-minute window) ──────────────────
const recentSeen = new Map();
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

export function dedupCheck(address) {
  const now = Date.now();
  for (const [k, ts] of recentSeen.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) recentSeen.delete(k);
  }
  if (recentSeen.has(address)) {
    return { pass: false, reason: "dedup: seen in last 10 minutes" };
  }
  recentSeen.set(address, now);
  return { pass: true };
}

// ─── Stage 2: Token blacklist ───────────────────────────────────────
export function blacklistCheck(mint) {
  const data = readBlacklistedMints();
  if (data[mint]) {
    return { pass: false, reason: `blacklisted: ${data[mint].reason || "no reason"}` };
  }
  return { pass: true };
}

// ─── Stage 3: Pool resolution (Meteora direct → DexScreener) ───────
export async function resolvePool(address) {
  // Try as Meteora pool address directly
  try {
    const res = await axios.get(`https://dlmm.datapi.meteora.ag/pools/${address}`, { timeout: 8000 });
    const pool = res.data;
    if (pool?.address || pool?.pubkey || pool?.pool_address) {
      const poolAddr = pool.address || pool.pubkey || pool.pool_address || address;
      const baseMint = pool.mint_x || pool.base_mint || pool.token_x?.address;
      const symbol = pool.name?.split("-")[0] || pool.token_x?.symbol || "?";
      const createdAt = pool.created_at || pool.pool_created_at || pool.token_x?.created_at;
      const tokenAgeMinutes = createdAt ? Math.round((Date.now() - new Date(createdAt).getTime()) / 60000) : null;
      return { pass: true, pool_address: poolAddr, base_mint: baseMint, symbol, source: "meteora_direct", token_age_minutes: tokenAgeMinutes };
    }
  } catch { /* not a pool address, try as mint */ }

  // Try as token mint via DexScreener → find Meteora DLMM pairs
  try {
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${address}`, { timeout: 8000 });
    const pairs = res.data?.pairs || [];
    const meteoraPairs = pairs.filter(p =>
      p.dexId === "meteora-dlmm" &&
      (p.baseToken?.address === address || p.quoteToken?.address === address)
    );
    if (meteoraPairs.length === 0) {
      return { pass: false, reason: "no Meteora DLMM pool found for this token" };
    }
    const best = meteoraPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    const pairCreated = best.pairCreatedAt ? new Date(best.pairCreatedAt).getTime() : null;
    const tokenAgeMinutes = pairCreated ? Math.round((Date.now() - pairCreated) / 60000) : null;
    return {
      pass: true,
      pool_address: best.pairAddress,
      base_mint: best.baseToken?.address,
      symbol: best.baseToken?.symbol || "?",
      source: "dexscreener",
      token_age_minutes: tokenAgeMinutes,
    };
  } catch (e) {
    return { pass: false, reason: `pool resolution failed: ${e.message}` };
  }
}

// ─── Stage 4: Rug check via rugcheck.xyz ──────────────────────────
export async function rugCheck(mint) {
  if (!mint) return { pass: true, rug_score: null };
  try {
    const res = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { timeout: 10000 });
    const data = res.data;
    if (data.rugged) return { pass: false, reason: "rugcheck: token is rugged" };
    if ((data.score || 0) > 50000) return { pass: false, reason: `rugcheck: score too high (${data.score})` };
    const topHolders = data.topHolders || [];
    const top10pct = topHolders.slice(0, 10).reduce((sum, h) => sum + (h.pct || h.percentage || 0), 0);
    if (top10pct > 60) return { pass: false, reason: `rugcheck: top10 holders ${top10pct.toFixed(1)}% > 60%` };
    return { pass: true, rug_score: data.score || 0 };
  } catch (e) {
    console.warn(`  [rugcheck] API error for ${mint}: ${e.message} — passing`);
    return { pass: true, rug_score: null };
  }
}

// ─── Stage 5: Deployer blacklist ────────────────────────────────────
export async function deployerCheck(poolAddress) {
  const data = readBlockedDeployers();
  const blocked = data.addresses || [];
  if (blocked.length === 0) return { pass: true };

  try {
    const res = await axios.get(`https://dlmm.datapi.meteora.ag/pools/${poolAddress}`, { timeout: 8000 });
    const creator = res.data?.creator || res.data?.creator_address;
    if (creator && blocked.includes(creator)) {
      return { pass: false, reason: `deployer blacklisted: ${creator}` };
    }
  } catch { /* can't check, pass */ }
  return { pass: true };
}

// ─── Stage 6: Global fees check via Jupiter API ────────────────────
export async function feesCheck(mint) {
  if (!mint) return { pass: true, global_fees_sol: null };

  const minFeesSol = readConfigMinFees();

  try {
    const res = await fetch(`https://datapi.jup.ag/v1/assets/search?query=${mint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const tokens = Array.isArray(data) ? data : [data];
    const token = tokens.find(t => t.id === mint) || tokens[0];
    const globalFees = token?.fees != null ? parseFloat(token.fees) : null;

    if (globalFees === null) {
      console.warn(`  [fees] No fee data for ${mint} — passing`);
      return { pass: true, global_fees_sol: null };
    }
    if (globalFees < minFeesSol) {
      return { pass: false, reason: `global fees too low: ${globalFees.toFixed(2)} SOL < ${minFeesSol} SOL threshold` };
    }
    return { pass: true, global_fees_sol: globalFees };
  } catch (e) {
    console.warn(`  [fees] Jupiter API error: ${e.message} — passing`);
    return { pass: true, global_fees_sol: null };
  }
}

// ─── Full pipeline ──────────────────────────────────────────────────
export async function runPreChecks(address) {
  console.log(`\n[pre-check] ${address}`);

  // Stage 1
  const dedup = dedupCheck(address);
  if (!dedup.pass) { console.log(`  REJECT [dedup] ${dedup.reason}`); return { pass: false, ...dedup }; }
  console.log(`  OK [dedup]`);

  // Stage 2
  const bl = blacklistCheck(address);
  if (!bl.pass) { console.log(`  REJECT [blacklist] ${bl.reason}`); return { pass: false, ...bl }; }
  console.log(`  OK [blacklist]`);

  // Stage 3
  const pool = await resolvePool(address);
  if (!pool.pass) { console.log(`  REJECT [pool] ${pool.reason}`); return { pass: false, ...pool }; }
  console.log(`  OK [pool] → ${pool.pool_address} (${pool.symbol}, via ${pool.source})`);

  // Re-check blacklist against resolved base_mint
  if (pool.base_mint && pool.base_mint !== address) {
    const bl2 = blacklistCheck(pool.base_mint);
    if (!bl2.pass) { console.log(`  REJECT [blacklist-mint] ${bl2.reason}`); return { pass: false, ...bl2 }; }
  }

  // Stage 4
  const rug = await rugCheck(pool.base_mint);
  if (!rug.pass) { console.log(`  REJECT [rug] ${rug.reason}`); return { pass: false, ...rug, ...pool }; }
  console.log(`  OK [rug] score=${rug.rug_score ?? "n/a"}`);

  // Stage 5
  const deployer = await deployerCheck(pool.pool_address);
  if (!deployer.pass) { console.log(`  REJECT [deployer] ${deployer.reason}`); return { pass: false, ...deployer, ...pool }; }
  console.log(`  OK [deployer]`);

  // Stage 6
  const fees = await feesCheck(pool.base_mint);
  if (!fees.pass) { console.log(`  REJECT [fees] ${fees.reason}`); return { pass: false, ...fees, ...pool }; }
  console.log(`  OK [fees] global_fees=${fees.global_fees_sol ?? "n/a"} SOL`);

  console.log(`  PASS → queuing signal (token age: ${pool.token_age_minutes ?? "unknown"} min)`);
  return {
    pass: true,
    pool_address: pool.pool_address,
    base_mint: pool.base_mint,
    symbol: pool.symbol,
    rug_score: rug.rug_score,
    total_fees_sol: fees.global_fees_sol,
    token_age_minutes: pool.token_age_minutes,
  };
}
