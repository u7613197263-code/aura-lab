import http from "node:http";

const PORT = Number(process.env.PORT || 10000);
const APP_ORIGIN = "https://aura-wallet-intelligence.onrender.com";
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, "https://aura-market-terminal-v1.onrender.com", "http://localhost:4173", "http://127.0.0.1:4173"]);
const CACHE = new Map();
const INFLIGHT = new Map();
const LAST_GOOD_FEEDS = new Map();
let geckoCooldownUntil = 0;
const REQUESTS = new Map();
const CACHE_LIMIT = 250;
const FEEDS = Object.freeze({
  trending: { path: "/networks/solana/trending_pools", label: "GeckoTerminal trending pools", ttl: 60000 },
  momentum: { path: "/networks/solana/trending_pools", label: "GeckoTerminal trending pools · sorted by 1h change", ttl: 60000 },
  toptraded: { path: "/networks/solana/trending_pools", label: "GeckoTerminal trending sample · sorted by 24h volume", ttl: 60000 },
  recent: { path: "/networks/solana/new_pools", label: "GeckoTerminal new pools", ttl: 60000 }
});

function json(res, status, body, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function cacheGet(key) {
  const item = CACHE.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(key, value, ttl) {
  if (CACHE.size >= CACHE_LIMIT) {
    const first = CACHE.keys().next().value;
    if (first) CACHE.delete(first);
  }
  CACHE.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

async function cached(key, ttl, loader) {
  const hit = cacheGet(key);
  if (hit !== null) return { data: hit, cached: true };
  if (INFLIGHT.has(key)) return { data: await INFLIGHT.get(key), cached: true };
  const promise = Promise.resolve().then(loader).then(value => cacheSet(key, value, ttl));
  INFLIGHT.set(key, promise);
  try { return { data: await promise, cached: false }; }
  finally { INFLIGHT.delete(key); }
}

function fetchJson(url, timeoutMs = 8500) {
  return new Promise(async (resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "AURA-Market-Dashboard/0.2" },
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error("Upstream HTTP " + response.status);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      resolve(payload);
    } catch (error) {
      reject(error);
    } finally {
      clearTimeout(timer);
    }
  });
}

function poolTokens(payload) {
  const included = new Map((payload.included || []).map(x => [x.id, x]));
  return (payload.data || []).map(pool => {
    const a = pool.attributes || {};
    const ref = pool.relationships?.base_token?.data?.id || "";
    const token = included.get(ref)?.attributes || {};
    const mint = ref.startsWith("solana_") ? ref.slice(7) : ref;
    const tx = a.transactions?.h24 || {};
    const ageDate = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
    const numeric = value => value == null || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
    return {
      id: mint, address: mint, name: token.name || a.name || "Unknown asset",
      symbol: token.symbol || a.name?.split(" / ")[0] || "TOKEN",
      usdPrice: numeric(a.base_token_price_usd),
      liquidity: numeric(a.reserve_in_usd),
      volume24h: numeric(a.volume_usd?.h24),
      buys24h: numeric(tx.buys), sells24h: numeric(tx.sells),
      poolCreatedAt: Number.isFinite(ageDate) ? ageDate : null,
      poolAddress: a.address || null,
      stats1h: {priceChange: numeric(a.price_change_percentage?.h1)},
      stats24h: {priceChange: numeric(a.price_change_percentage?.h24)},
      organicScore: null, isVerified: null, source: "GeckoTerminal"
    };
  }).filter(x => validMint(x.id));
}

async function dexFallback(feedName) {
  // This is an explicitly promotional / profiled discovery sample, never called market-wide trending.
  const profilePath = feedName === "recent" ? "/token-profiles/latest/v1" : "/token-boosts/latest/v1";
  const profiles = await fetchJson("https://api.dexscreener.com" + profilePath);
  if (!Array.isArray(profiles)) throw new Error("DEX Screener returned no discovery profiles");
  const mints = [...new Set(profiles.filter(x => x.chainId === "solana" && validMint(x.tokenAddress)).map(x => x.tokenAddress))].slice(0, 30);
  if (!mints.length) throw new Error("No Solana tokens in DEX Screener discovery sample");
  const pairs = await fetchJson("https://api.dexscreener.com/tokens/v1/solana/" + mints.join(","));
  const rows = Array.isArray(pairs) ? pairs : [];
  const wanted = new Set(mints);
  const itemMap = new Map();
  const numeric = value => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  for (const p of rows) {
    const mint = p.baseToken?.address;
    if (!wanted.has(mint) || !validMint(mint)) continue;
    const t = {
      id: mint, address: mint, name: p.baseToken?.name || "Unknown asset",
      symbol: p.baseToken?.symbol || "TOKEN",
      usdPrice: numeric(p.priceUsd), liquidity: numeric(p.liquidity?.usd),
      volume24h: numeric(p.volume?.h24),
      buys24h: numeric(p.txns?.h24?.buys), sells24h: numeric(p.txns?.h24?.sells),
      poolCreatedAt: numeric(p.pairCreatedAt), poolAddress: p.pairAddress || null,
      stats1h: {priceChange: numeric(p.priceChange?.h1)},
      stats24h: {priceChange: numeric(p.priceChange?.h24)},
      organicScore: null, isVerified: null, source: "DEX Screener"
    };
    const previous = itemMap.get(mint);
    if (!previous || (t.liquidity ?? 0) > (previous.liquidity ?? 0)) itemMap.set(mint, t);
  }
  const items = [...itemMap.values()];
  if (!items.length) throw new Error("No priced Solana pairs in DEX Screener sample");
  items.sort((a,b)=>(b.liquidity??0)-(a.liquidity??0));
  return {sampledAt:new Date().toISOString(),items,
    label:feedName === "recent"?"DEX Screener recently profiled Solana tokens":
      "DEX Screener recently boosted Solana tokens (promotional discovery sample)"};
}

function clientAllowed(req) {
  const origin = req.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function rateAllowed(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = REQUESTS.get(ip) || { start: now, count: 0 };
  if (now - current.start > 60000) {
    current.start = now;
    current.count = 0;
  }
  current.count += 1;
  REQUESTS.set(ip, current);
  return current.count <= 45;
}

function asItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.tokens)) return payload.tokens;
  return [];
}

function validMint(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
function validPool(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(value);
}
function safeText(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

async function route(req, res) {
  const origin = req.headers.origin || "";
  if (!clientAllowed(req)) return json(res, 403, { error: "Origin not allowed." }, "");
  if (req.method === "OPTIONS") return json(res, 204, {}, origin);
  if (req.method !== "GET") return json(res, 405, { error: "GET only." }, origin);
  if (!rateAllowed(req)) return json(res, 429, { error: "AURA API rate limit. Retry shortly." }, origin);

  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/health") {
      return json(res, 200, {
        service: "AURA Market API",
        version: "0.3.1",
        status: "ok",
        timestamp: new Date().toISOString(),
        providers: ["DEX Screener", "GeckoTerminal"]
      }, origin);
    }

    if (url.pathname === "/api/market/feeds") {
      const name = safeText(url.searchParams.get("feed") || "trending", 20);
      const feed = FEEDS[name];
      if (!feed) return json(res, 400, { error: "Unsupported feed." }, origin);
      try {
        if (Date.now() < geckoCooldownUntil) throw new Error("GeckoTerminal in temporary rate-limit cooldown");
        const result = await cached("gecko:" + feed.path, feed.ttl, async () => ({
          sampledAt: new Date().toISOString(),
          payload: await fetchJson("https://api.geckoterminal.com/api/v2" + feed.path + "?include=base_token")
        }));
        const items = poolTokens(result.data.payload);
        if (!items.length) throw new Error("GeckoTerminal did not return usable Solana token metadata");
        LAST_GOOD_FEEDS.set(feed.path,{items, sampledAt:result.data.sampledAt, storedAt:Date.now()});
        if (name === "momentum") items.sort((a, b) => (b.stats1h.priceChange ?? -999) - (a.stats1h.priceChange ?? -999));
        if (name === "toptraded") items.sort((a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1));
        return json(res, 200, {source:"GeckoTerminal", feed:name, label:feed.label,
          fetchedAt:result.data.sampledAt,cached:result.cached,items,fallback:false},origin);
      } catch (primaryError) {
        if (primaryError?.status === 429) geckoCooldownUntil = Date.now() + 120000;
        const last = LAST_GOOD_FEEDS.get(feed.path);
        if (last && Date.now()-last.storedAt < 300000) {
          const items = [...last.items];
          if(name==="momentum")items.sort((a,b)=>(b.stats1h.priceChange??-999)-(a.stats1h.priceChange??-999));
          if(name==="toptraded")items.sort((a,b)=>(b.volume24h??-1)-(a.volume24h??-1));
          return json(res,200,{source:"GeckoTerminal",feed:name,label:feed.label,
            fetchedAt:last.sampledAt,cached:true,stale:true,fallback:false,items,
            providerWarning:"Primary provider rate-limited. Showing source-stamped last-good sample (up to 5 min old)."},origin);
        }
        const secondary = await cached("dex-fallback:"+(name==="recent"?"recent":"boosted"),90000,()=>dexFallback(name));
        const backupItems=[...secondary.data.items];
        if(name==="momentum")backupItems.sort((a,b)=>(b.stats1h.priceChange??-999)-(a.stats1h.priceChange??-999));
        if(name==="toptraded")backupItems.sort((a,b)=>(b.volume24h??-1)-(a.volume24h??-1));
        return json(res,200,{source:"DEX Screener",feed:name,label:secondary.data.label,
          fetchedAt:secondary.data.sampledAt,cached:secondary.cached,items:backupItems,
          fallback:true,sourceScope:"promotional-or-profiled-sample",
          providerWarning:"Primary GeckoTerminal feed unavailable. Using a curated DEX Screener sample; it is not market-wide trending."},origin);
      }
    }

    if (url.pathname === "/api/market/price") {
      const mint = safeText(url.searchParams.get("mint"), 50);
      if (!validMint(mint)) return json(res, 400, { error: "Invalid Solana mint address." }, origin);
      const result = await cached("price:" + mint, 30000, () =>
        fetchJson("https://api.dexscreener.com/tokens/v1/solana/" + encodeURIComponent(mint))
      );
      const pairs = Array.isArray(result.data) ? result.data : [];
      const pair = pairs.sort((a,b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
      return json(res, 200, { source: "DEX Screener", mint, cached: result.cached,
        fetchedAt: new Date().toISOString(),
        price: pair ? {usdPrice:Number(pair.priceUsd),priceChange24h:pair.priceChange?.h24} : null }, origin);
    }

    if (url.pathname === "/api/market/search") {
      const query = safeText(url.searchParams.get("q"), 64);
      if (query.length < 2) return json(res, 400, { error: "Enter at least two characters." }, origin);
      const result = await cached("search:" + query.toLowerCase(), 30000, () =>
        fetchJson("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(query))
      );
      const pairs = (result.data?.pairs || []).filter(p => p.chainId === "solana");
      const seen = new Set();
      const items = pairs.map(p => ({id:p.baseToken?.address, name:p.baseToken?.name,
        symbol:p.baseToken?.symbol, usdPrice:Number(p.priceUsd),
        liquidity:Number(p.liquidity?.usd), stats24h:{priceChange:p.priceChange?.h24}}))
        .filter(t => validMint(t.id) && !seen.has(t.id) && seen.add(t.id));
      return json(res, 200, {source:"DEX Screener", fetchedAt:new Date().toISOString(),cached:result.cached,items}, origin);
    }

    if (url.pathname === "/api/market/token") {
      const mint = safeText(url.searchParams.get("mint"), 50);
      if (!validMint(mint)) return json(res, 400, { error: "Invalid Solana mint address." }, origin);
      const result = await cached("token:" + mint, 15000, async () => {
        const outcomes = await Promise.allSettled([
          jupiter("https://api.jup.ag/tokens/v2/search?query=" + encodeURIComponent(mint)),
          fetchJson("https://api.dexscreener.com/tokens/v1/solana/" + encodeURIComponent(mint))
        ]);
        const tokenRows = outcomes[0].status === "fulfilled" ? asItems(outcomes[0].value) : [];
        const pairs = outcomes[1].status === "fulfilled" && Array.isArray(outcomes[1].value) ? outcomes[1].value : [];
        return {
          token: tokenRows.find(x => x.id === mint || x.address === mint) || tokenRows[0] || null,
          pairs: pairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)),
          providerWarnings: outcomes.map((x, i) => x.status === "rejected" ? (i === 0 ? "Jupiter token lookup unavailable" : "DEX Screener pair lookup unavailable") : null).filter(Boolean)
        };
      });
      return json(res, 200, {
        source: ["DEX Screener"],
        fetchedAt: new Date().toISOString(),
        cached: result.cached,
        mint,
        ...result.data
      }, origin);
    }

    if (url.pathname === "/api/market/chart") {
      const pool = safeText(url.searchParams.get("pool"), 60);
      const timeframe = safeText(url.searchParams.get("timeframe") || "minute", 10);
      const aggregate = safeText(url.searchParams.get("aggregate") || "5", 2);
      const allowedTimeframes = new Set(["minute", "hour", "day"]);
      const allowedAggregates = new Set(["1", "5", "15", "30", "60", "4"]);
      if (!validPool(pool) || !allowedTimeframes.has(timeframe) || !allowedAggregates.has(aggregate)) {
        return json(res, 400, { error: "Invalid chart parameters." }, origin);
      }
      const ttl = 60000;
      const result = await cached("chart:" + pool + ":" + timeframe + ":" + aggregate, ttl, () => {
        const target = new URL("https://api.geckoterminal.com/api/v2/networks/solana/pools/" + encodeURIComponent(pool) + "/ohlcv/" + timeframe);
        target.searchParams.set("aggregate", aggregate);
        target.searchParams.set("limit", "100");
        target.searchParams.set("currency", "usd");
        target.searchParams.set("token", "base");
        return fetchJson(target.toString());
      });
      const rows = result.data?.data?.attributes?.ohlcv_list || [];
      return json(res, 200, {
        source: "GeckoTerminal OHLCV",
        fetchedAt: new Date().toISOString(),
        cached: result.cached,
        pool,
        timeframe,
        aggregate,
        candles: rows
      }, origin);
    }

    return json(res, 404, { error: "Route not found." }, origin);
  } catch (error) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 500 ? 502 : 503;
    return json(res, status, {
      error: "Market data provider is temporarily unavailable.",
      detail: safeText(error?.message || "Unknown upstream error", 160),
      retryable: true,
      timestamp: new Date().toISOString()
    }, origin);
  }
}

const server = http.createServer((req, res) => {
  route(req, res).catch(error => json(res, 500, { error: safeText(error?.message || "Internal error", 120) }, req.headers.origin || ""));
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("AURA Market API listening on port " + PORT);
});
