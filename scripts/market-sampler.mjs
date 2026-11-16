import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import assert from "node:assert/strict";

const API = "https://api.dexscreener.com";
const LEDGER_PATH = "data/market-ledger.json";
const HORIZONS = [
  { seconds: 300, label: "5m", graceSeconds: 30 * 60 },
  { seconds: 900, label: "15m", graceSeconds: 60 * 60 },
  { seconds: 3600, label: "1h", graceSeconds: 3 * 60 * 60 },
  { seconds: 21600, label: "6h", graceSeconds: 12 * 60 * 60 },
  { seconds: 86400, label: "24h", graceSeconds: 48 * 60 * 60 }
];
const MAX_NEW_ASSETS_PER_RUN = 2;
const MAX_ASSETS = 2600;
const RETAIN_MS = 4 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 30;

function iso(ms) { return new Date(ms).toISOString(); }
function number(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}
function emptyLedger(now = Date.now()) {
  return {
    schema_version: 1,
    generated_at: iso(now),
    sampler: {
      status: "initializing",
      interval_minutes: 5,
      last_run_at: null,
      last_success_at: null,
      run_count: 0,
      successful_runs: 0,
      discovery_status: "pending",
      market_status: "pending",
      last_error: null,
      note: "Best-effort background sampling. Scheduled GitHub Actions can be delayed or disabled."
    },
    summary: { tracked_assets: 0, captured_outcomes: 0, missed_outcomes: 0, pending_outcomes: 0 },
    assets: []
  };
}
async function fetchJson(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "AURA-Crypto-Signal-Lab/0.2.3" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("HTTP " + response.status + " from " + new URL(url).host);
    return await response.json();
  } finally { clearTimeout(timer); }
}
function scorePair(pair) {
  const liquidity = number(pair.liquidity?.usd);
  const volume = number(pair.volume?.h1);
  const tx = pair.txns?.h1 || {};
  const buys = number(tx.buys), sells = number(tx.sells), total = buys + sells;
  const change = number(pair.priceChange?.h1);
  const ageHours = pair.pairCreatedAt ? Math.max(0, (Date.now() - Number(pair.pairCreatedAt)) / 3600000) : 999;
  let score = 0;
  score += Math.min(25, Math.log10(Math.max(1, liquidity)) * 3.6);
  score += Math.min(20, Math.log10(Math.max(1, (volume / Math.max(liquidity, 1)) * 100)) * 3.4);
  score += Math.min(18, Math.log10(total + 1) * 6);
  score += Math.min(10, total ? (buys / total) * 10 : 0);
  score += Math.max(0, 10 - Math.abs(change) * 0.45);
  score += Math.min(7, Math.max(0, ageHours) * 1.3);
  score = Math.round(Math.max(0, Math.min(100, score)));
  const flags = [];
  let risk = 0;
  if (liquidity < 10000) { risk += 30; flags.push("very_thin_liquidity"); }
  else if (liquidity < 30000) { risk += 18; flags.push("low_liquidity"); }
  if (ageHours < 1) { risk += 25; flags.push("pair_under_1h"); }
  else if (ageHours < 6) { risk += 12; flags.push("pair_under_6h"); }
  if (total < 8) { risk += 15; flags.push("low_txn_count"); }
  if (total > 0 && sells / total > 0.7) { risk += 14; flags.push("sell_pressure"); }
  if (Math.abs(change) > 80) { risk += 15; flags.push("extreme_1h_move"); }
  if (number(pair.boosts?.active) > 0) flags.push("paid_boost_active");
  return { score, risk: Math.min(100, risk), flags, liquidityUsd: liquidity, volume1hUsd: volume, buys1h: buys, sells1h: sells, priceChange1hPct: change, pairAgeHours: ageHours };
}
function bestPairsByMint(pairs) {
  const map = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (pair.chainId !== "solana" || !pair.baseToken?.address) continue;
    const address = pair.baseToken.address;
    const current = map.get(address);
    if (!current || number(pair.liquidity?.usd) > number(current.liquidity?.usd)) map.set(address, pair);
  }
  return map;
}
function outcomeTemplate(now, horizon) {
  const targetAt = now + horizon.seconds * 1000;
  return {
    horizon_seconds: horizon.seconds,
    label: horizon.label,
    target_at: iso(targetAt),
    deadline_at: iso(targetAt + horizon.graceSeconds * 1000),
    status: "pending",
    attempts: 0,
    sampled_at: null,
    delay_seconds: null,
    price_usd: null,
    return_pct: null,
    liquidity_usd: null,
    reason: null
  };
}
function snapshot(pair, sampledAt) {
  const stats = scorePair(pair);
  return {
    sampled_at: iso(sampledAt),
    price_usd: number(pair.priceUsd),
    liquidity_usd: stats.liquidityUsd,
    volume_1h_usd: stats.volume1hUsd,
    buys_1h: stats.buys1h,
    sells_1h: stats.sells1h,
    price_change_1h_pct: stats.priceChange1hPct,
    heuristic_score: stats.score,
    risk_score: stats.risk,
    risk_flags: stats.flags,
    pair_address: pair.pairAddress || null,
    dex_url: pair.url || null,
    fdv_usd: number(pair.fdv),
    market_cap_usd: number(pair.marketCap)
  };
}
function freshAsset(pair, discovery, now) {
  const first = snapshot(pair, now);
  if (!(first.price_usd > 0)) return null;
  return {
    mint: pair.baseToken.address,
    symbol: pair.baseToken.symbol || "UNKNOWN",
    name: pair.baseToken.name || "Unknown token",
    chain: "solana",
    discovered_at: iso(now),
    discovery_sources: discovery.sources,
    boost_amount: discovery.boostAmount,
    initial: first,
    last_market: first,
    last_market_at: first.sampled_at,
    outcomes: HORIZONS.map(h => outcomeTemplate(now, h))
  };
}
function summarize(assets) {
  const all = assets.flatMap(a => a.outcomes || []);
  return {
    tracked_assets: assets.length,
    captured_outcomes: all.filter(o => o.status === "captured").length,
    missed_outcomes: all.filter(o => o.status.startsWith("missed") || o.status === "no_market").length,
    pending_outcomes: all.filter(o => o.status === "pending").length
  };
}
function mergeDiscovery(feeds) {
  const byAddress = new Map();
  for (const feed of feeds) {
    for (const item of feed.items || []) {
      if (item.chainId !== "solana" || !item.tokenAddress) continue;
      const current = byAddress.get(item.tokenAddress) || { address: item.tokenAddress, sources: [], boostAmount: 0 };
      if (!current.sources.includes(feed.name)) current.sources.push(feed.name);
      current.boostAmount = Math.max(current.boostAmount, number(item.amount), number(item.totalAmount));
      byAddress.set(item.tokenAddress, current);
    }
  }
  return [...byAddress.values()].sort((a, b) => {
    const priority = x => x.sources.includes("profile") ? 3 : 0;
    return (priority(b) + Math.log10(b.boostAmount + 1)) - (priority(a) + Math.log10(a.boostAmount + 1));
  });
}
async function getDiscoveryFeeds() {
  const endpoints = [
    ["profile", "/token-profiles/latest/v1"],
    ["boost", "/token-boosts/latest/v1"],
    ["community_takeover", "/community-takeovers/latest/v1"],
    ["ad", "/ads/latest/v1"]
  ];
  const results = await Promise.all(endpoints.map(async ([name, path]) => {
    try {
      const json = await fetchJson(API + path);
      return { name, ok: true, items: Array.isArray(json) ? json : (json ? [json] : []) };
    } catch (error) {
      return { name, ok: false, items: [], error: error.message };
    }
  }));
  return {
    feeds: results.filter(r => r.ok),
    errors: results.filter(r => !r.ok).map(r => r.name + ": " + r.error)
  };
}
async function getPairs(addresses) {
  const map = new Map();
  const successful = new Set();
  const failed = [];
  for (const batch of chunks(unique(addresses), BATCH_SIZE)) {
    try {
      const pairs = await fetchJson(API + "/tokens/v1/solana/" + batch.join(","));
      for (const address of batch) successful.add(address);
      for (const [address, pair] of bestPairsByMint(pairs)) {
        const old = map.get(address);
        if (!old || number(pair.liquidity?.usd) > number(old.liquidity?.usd)) map.set(address, pair);
      }
    } catch (error) {
      failed.push({ addresses: batch, error: error.message });
    }
  }
  return { map, successful, failed };
}
function markOverdue(asset, now) {
  for (const outcome of asset.outcomes || []) {
    if (outcome.status !== "pending") continue;
    if (now > Date.parse(outcome.deadline_at)) {
      outcome.status = "missed_window";
      outcome.reason = "No valid market sample was obtained before the sampling deadline.";
      outcome.sampled_at = iso(now);
    }
  }
}
function applyDueSample(asset, pair, now) {
  const price = number(pair?.priceUsd);
  const firstPrice = number(asset.initial?.price_usd);
  if (!(price > 0) || !(firstPrice > 0)) return 0;
  const current = snapshot(pair, now);
  let captured = 0;
  for (const outcome of asset.outcomes || []) {
    if (outcome.status !== "pending") continue;
    const target = Date.parse(outcome.target_at);
    const deadline = Date.parse(outcome.deadline_at);
    if (now < target) continue;
    if (now > deadline) {
      outcome.status = "missed_window";
      outcome.reason = "The scheduled sample window elapsed before a valid price was available.";
      outcome.sampled_at = iso(now);
      continue;
    }
    outcome.status = "captured";
    outcome.sampled_at = iso(now);
    outcome.delay_seconds = Math.round((now - target) / 1000);
    outcome.price_usd = price;
    outcome.return_pct = (price / firstPrice - 1) * 100;
    outcome.liquidity_usd = current.liquidity_usd;
    outcome.reason = null;
    captured++;
  }
  asset.last_market = current;
  asset.last_market_at = current.sampled_at;
  return captured;
}
function selfTest() {
  const pair = {
    chainId: "solana", pairAddress: "pair-1", url: "https://dexscreener.com/solana/pair-1",
    baseToken: { address: "mint-1", symbol: "TST", name: "Test" }, priceUsd: "2",
    liquidity: { usd: 20000 }, volume: { h1: 3000 }, txns: { h1: { buys: 12, sells: 8 } },
    priceChange: { h1: 5 }, pairCreatedAt: Date.now() - 3 * 3600000
  };
  const stats = scorePair(pair);
  assert.ok(stats.score >= 0 && stats.score <= 100);
  const a = freshAsset(pair, { sources: ["profile"], boostAmount: 0 }, 1000000);
  assert.equal(a.outcomes.length, 5);
  const outcome = a.outcomes.find(x => x.horizon_seconds === 300);
  const t = Date.parse(outcome.target_at);
  assert.equal(applyDueSample(a, { ...pair, priceUsd: "2.2" }, t + 60000), 1);
  assert.equal(outcome.status, "captured");
  assert.ok(Math.abs(outcome.return_pct - 10) < 1e-9);
  const late = freshAsset(pair, { sources: [], boostAmount: 0 }, 1000000);
  const lateOutcome = late.outcomes.find(x => x.horizon_seconds === 300);
  applyDueSample(late, pair, Date.parse(lateOutcome.deadline_at) + 1000);
  assert.equal(lateOutcome.status, "missed_window");
  const byMint = bestPairsByMint([pair, { ...pair, liquidity: { usd: 50000 }, pairAddress: "pair-2" }]);
  assert.equal(byMint.get("mint-1").pairAddress, "pair-2");
  const feeds = mergeDiscovery([{ name: "profile", items: [{ chainId: "solana", tokenAddress: "mint-a" }] }, { name: "boost", items: [{ chainId: "solana", tokenAddress: "mint-a", totalAmount: 10 }] }]);
  assert.equal(feeds.length, 1);
  assert.deepEqual(feeds[0].sources.sort(), ["boost", "profile"]);
  console.log("Sampler self-test: 6 assertions passed.");
}
async function readLedger() {
  try {
    const data = JSON.parse(await readFile(LEDGER_PATH, "utf8"));
    if (data.schema_version !== 1 || !Array.isArray(data.assets)) throw new Error("Unexpected market ledger schema");
    return data;
  } catch (error) {
    if (error.code === "ENOENT") return emptyLedger();
    throw error;
  }
}
async function writeLedger(ledger) {
  await mkdir(dirname(LEDGER_PATH), { recursive: true });
  await writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}
async function run() {
  const now = Date.now();
  const ledger = await readLedger();
  ledger.sampler = ledger.sampler || emptyLedger(now).sampler;
  ledger.sampler.status = "running";
  ledger.sampler.last_run_at = iso(now);
  ledger.sampler.run_count = number(ledger.sampler.run_count) + 1;
  const assets = ledger.assets;
  for (const asset of assets) markOverdue(asset, now);

  const discovery = await getDiscoveryFeeds();
  ledger.sampler.discovery_status = discovery.feeds.length ? (discovery.errors.length ? "partial" : "online") : "unavailable";

  const dueAssets = assets.filter(asset => (asset.outcomes || []).some(outcome => outcome.status === "pending" && now >= Date.parse(outcome.target_at) && now <= Date.parse(outcome.deadline_at)));
  const existingMints = new Set(assets.map(asset => asset.mint));
  const candidates = mergeDiscovery(discovery.feeds);
  const candidateMints = candidates.map(candidate => candidate.address).filter(address => !existingMints.has(address)).slice(0, 30);
  const lookupMints = unique(dueAssets.map(asset => asset.mint).concat(candidateMints));
  const { map: pairs, successful, failed } = await getPairs(lookupMints);

  let capturedThisRun = 0;
  for (const asset of dueAssets) {
    if (!successful.has(asset.mint)) continue;
    const pair = pairs.get(asset.mint);
    if (pair && number(pair.priceUsd) > 0) {
      capturedThisRun += applyDueSample(asset, pair, now);
    } else {
      for (const outcome of asset.outcomes) {
        if (outcome.status !== "pending" || now < Date.parse(outcome.target_at)) continue;
        outcome.attempts = number(outcome.attempts) + 1;
        if (now > Date.parse(outcome.deadline_at)) {
          outcome.status = "no_market";
          outcome.reason = "Token pair was not returned by the market data provider before the deadline.";
          outcome.sampled_at = iso(now);
        }
      }
    }
  }

  const newAssets = [];
  for (const candidate of candidates) {
    if (newAssets.length >= MAX_NEW_ASSETS_PER_RUN || assets.length + newAssets.length >= MAX_ASSETS) break;
    if (existingMints.has(candidate.address) || newAssets.some(asset => asset.mint === candidate.address)) continue;
    const pair = pairs.get(candidate.address);
    if (!pair || !(number(pair.priceUsd) > 0)) continue;
    const asset = freshAsset(pair, candidate, now);
    if (asset) newAssets.push(asset);
  }
  assets.push(...newAssets);

  const cutoff = now - RETAIN_MS;
  const retained = assets.filter(asset => {
    const created = Date.parse(asset.discovered_at);
    if (Number.isFinite(created) && created >= cutoff) return true;
    return (asset.outcomes || []).some(o => o.status === "pending");
  });
  ledger.assets = retained.slice(-MAX_ASSETS);
  ledger.generated_at = iso(now);
  const runOk = discovery.feeds.length > 0 || successful.size > 0;
  const hasErrors = discovery.errors.length > 0 || failed.length > 0;
  ledger.sampler.status = !runOk ? "unavailable" : hasErrors ? "partial" : "online";
  ledger.sampler.market_status = failed.length ? "partial" : (lookupMints.length ? "online" : "idle");
  if (runOk) {
    ledger.sampler.last_success_at = iso(now);
    ledger.sampler.successful_runs = number(ledger.sampler.successful_runs) + 1;
  }
  ledger.sampler.last_error = [...discovery.errors, ...failed.map(item => item.error)].slice(0, 8).join(" | ") || (!runOk ? "No public market-data endpoint succeeded in this run." : null);
  ledger.sampler.last_discovery_count = candidates.length;
  ledger.sampler.new_assets_this_run = newAssets.length;
  ledger.sampler.due_assets_this_run = dueAssets.length;
  ledger.sampler.captured_this_run = capturedThisRun;
  ledger.sampler.failed_batches = failed.length;
  ledger.summary = summarize(ledger.assets);
  await writeLedger(ledger);

  console.log(JSON.stringify({
    status: ledger.sampler.status,
    run_at: ledger.sampler.last_run_at,
    discovery_feeds_ok: discovery.feeds.map(feed => feed.name),
    discovery_candidates: candidates.length,
    new_assets: newAssets.length,
    due_assets: dueAssets.length,
    captured_outcomes: capturedThisRun,
    failed_batches: failed.length,
    summary: ledger.summary
  }, null, 2));
}
if (process.argv.includes("--self-test")) selfTest();
else run().catch(error => { console.error(error); process.exitCode = 1; });
