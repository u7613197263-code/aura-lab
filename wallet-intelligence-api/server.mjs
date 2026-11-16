import http from "node:http";

const PORT = Number(process.env.PORT || 10000);
const APP_ORIGIN = "https://aura-wallet-intelligence.onrender.com";
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, "http://localhost:4173", "http://127.0.0.1:4173"]);
const CACHE = new Map();
const REQUESTS = new Map();
const CACHE_LIMIT = 250;
let lastJupiterRequest = 0;
let jupiterQueue = Promise.resolve();

const FEEDS = Object.freeze({
  trending: { path: "/tokens/v2/toptrending/1h", label: "Jupiter trending · 1h", ttl: 30000 },
  organic: { path: "/tokens/v2/toporganicscore/5m", label: "Jupiter organic activity · 5m", ttl: 30000 },
  toptraded: { path: "/tokens/v2/toptraded/1h", label: "Jupiter top traded · 1h", ttl: 30000 },
  recent: { path: "/tokens/v2/recent", label: "Jupiter recently pooled", ttl: 60000 }
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
  const value = await loader();
  cacheSet(key, value, ttl);
  return { data: value, cached: false };
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

function jupiter(url) {
  const run = async () => {
    const wait = Math.max(0, 2100 - (Date.now() - lastJupiterRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastJupiterRequest = Date.now();
    return fetchJson(url);
  };
  const next = jupiterQueue.then(run, run);
  jupiterQueue = next.catch(() => {});
  return next;
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
        version: "0.2.0",
        status: "ok",
        timestamp: new Date().toISOString(),
        providers: ["Jupiter Tokens/Price API", "DEX Screener", "GeckoTerminal"]
      }, origin);
    }

    if (url.pathname === "/api/market/feeds") {
      const name = safeText(url.searchParams.get("feed") || "trending", 20);
      const feed = FEEDS[name];
      if (!feed) return json(res, 400, { error: "Unsupported feed." }, origin);
      const result = await cached("feed:" + name, feed.ttl, () =>
        jupiter("https://api.jup.ag" + feed.path)
      );
      return json(res, 200, {
        source: "Jupiter Tokens V2",
        feed: name,
        label: feed.label,
        fetchedAt: new Date().toISOString(),
        cached: result.cached,
        items: asItems(result.data)
      }, origin);
    }

    if (url.pathname === "/api/market/price") {
      const mint = safeText(url.searchParams.get("mint"), 50);
      if (!validMint(mint)) return json(res, 400, { error: "Invalid Solana mint address." }, origin);
      const result = await cached("price:" + mint, 15000, () =>
        jupiter("https://api.jup.ag/price/v3?ids=" + encodeURIComponent(mint))
      );
      const row = result.data?.[mint] || null;
      return json(res, 200, {
        source: "Jupiter Price V3",
        fetchedAt: new Date().toISOString(),
        cached: result.cached,
        mint,
        price: row
      }, origin);
    }

    if (url.pathname === "/api/market/search") {
      const query = safeText(url.searchParams.get("q"), 64);
      if (query.length < 2) return json(res, 400, { error: "Enter at least two characters." }, origin);
      const key = "search:" + query.toLowerCase();
      const result = await cached(key, 15000, () =>
        jupiter("https://api.jup.ag/tokens/v2/search?query=" + encodeURIComponent(query))
      );
      return json(res, 200, {
        source: "Jupiter Tokens V2",
        fetchedAt: new Date().toISOString(),
        cached: result.cached,
        items: asItems(result.data)
      }, origin);
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
        source: ["Jupiter Tokens V2", "DEX Screener"],
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
