(() => {
  "use strict";
  const API = "https://aura-market-api.onrender.com";
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const $ = id => document.getElementById(id);
  const state = { feed: "trending", items: [], selected: null, detail: null, chart: "hour", timer: null, lastGood: null };
  const WATCH_KEY = "aura-market-watchlist-v1";

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function num(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toLocaleString(undefined, {maximumFractionDigits: n < 1 ? 8 : 2});
  }
  function pct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function pctClass(v) {
    const n = Number(v);
    return !Number.isFinite(n) ? "" : n > 0 ? "positive" : n < 0 ? "negative" : "";
  }
  function tokenId(t) { return t?.id || t?.address || t?.mint || ""; }
  function priceOf(t) { return t?.usdPrice ?? t?.priceUsd ?? t?.price?.usdPrice ?? null; }
  function stats(t, interval) {
    return t?.["stats" + interval] || t?.stats?.[interval] || {};
  }
  function priceChange(t, interval) {
    const s = stats(t, interval);
    return s.priceChange ?? s.priceChangePct ?? t?.["priceChange" + interval] ?? null;
  }
  function getWatchlist() {
    try { const x = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); return Array.isArray(x) ? x : []; }
    catch { return []; }
  }
  function isWatched(mint) { return getWatchlist().includes(mint); }
  function toggleWatch(mint) {
    const list = getWatchlist();
    const next = list.includes(mint) ? list.filter(x => x !== mint) : [...list, mint].slice(-100);
    localStorage.setItem(WATCH_KEY, JSON.stringify(next));
    loadWatchlist();
    renderDetail();
    renderFeed();
  }
  async function api(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 78000);
    try {
      const r = await fetch(API + path, {headers: {Accept:"application/json"}, credentials:"omit", signal:controller.signal});
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.detail || body?.error || ("API HTTP " + r.status));
      return body;
    } finally { clearTimeout(timer); }
  }
  function setStatus(text, type) {
    const el = $("market-status");
    if (!el) return;
    el.textContent = text;
    el.className = "pill " + (type || "");
  }
  function formatAge(epoch) {
    if (!epoch) return "—";
    const mins = Math.max(0, Math.floor((Date.now() - Number(epoch)) / 60000));
    if (mins < 60) return mins + "m";
    if (mins < 1440) return Math.floor(mins / 60) + "h";
    return Math.floor(mins / 1440) + "d";
  }
  function empty(message) {
    $("market-list").innerHTML = '<div class="empty">' + esc(message) + '</div>';
  }
  function renderFeed() {
    const minLiq = Number($("market-min-liquidity")?.value || 0);
    const rows = state.items.filter(t => Number(t?.liquidity || t?.liquidityUsd || 0) >= minLiq);
    if (!rows.length) return empty(state.items.length ? "No tokens match this liquidity filter." : "No market data returned by the provider.");
    $("market-list").innerHTML = rows.slice(0, 30).map((t, i) => {
      const mint = tokenId(t);
      const change = priceChange(t, "1h") ?? priceChange(t, "24h");
      const symbol = t.symbol || "TOKEN";
      const title = t.name || symbol;
      const score = t.organicScore == null ? NaN : Number(t.organicScore);
      const verified = t.isVerified === true ? "VERIFIED" : t.isVerified === false ? "UNVERIFIED" : "STATUS UNKNOWN";
      return '<button class="market-token" type="button" data-token="' + esc(mint) + '">' +
        '<span class="market-rank">' + String(i + 1).padStart(2,"0") + '</span>' +
        '<span class="market-token-main"><b>' + esc(title) + '</b><small>' + esc(symbol) + ' · ' + esc(verified) + '</small></span>' +
        '<span class="market-token-price"><b>' + num(priceOf(t)) + '</b><small class="' + pctClass(change) + '">' + pct(change) + '</small></span>' +
        '<span class="market-token-meta"><b>' + (Number.isFinite(score) ? score.toFixed(0) : "—") + '</b><small>organic</small></span>' +
        '<span class="market-token-arrow">›</span></button>';
    }).join("");
    $("market-list").querySelectorAll("[data-token]").forEach(b => b.addEventListener("click", () => openToken(b.dataset.token)));
  }
  function detailMarkup(token, pair) {
    const mint = state.selected;
    const liq = Number(pair?.liquidity?.usd ?? token?.liquidity ?? 0);
    const vol = Number(pair?.volume?.h24 ?? token?.stats24h?.volume ?? 0);
    const mcap = Number(pair?.marketCap ?? pair?.fdv ?? token?.mcap ?? token?.fdv ?? 0);
    const verified = token?.isVerified === true ? "Provider verified" : token?.isVerified === false ? "Unverified" : "Verification unknown";
    const audit = token?.audit || {};
    const sus = Object.prototype.hasOwnProperty.call(audit, "isSus") && audit.isSus === true;
    const score = token?.organicScore == null ? NaN : Number(token.organicScore);
    const mintAuthority = audit.mintAuthority;
    const freezeAuthority = audit.freezeAuthority;
    let flags = '<span class="risk-chip">' + esc(verified) + '</span>';
    if (Number.isFinite(score)) flags += '<span class="risk-chip">Organic score ' + score.toFixed(0) + '/100</span>';
    if (sus) flags += '<span class="risk-chip danger">Jupiter flagged as suspicious</span>';
    if (mintAuthority !== undefined) flags += '<span class="risk-chip ' + (mintAuthority ? "danger" : "") + '">Mint authority ' + (mintAuthority ? "active" : "revoked") + '</span>';
    if (freezeAuthority !== undefined) flags += '<span class="risk-chip ' + (freezeAuthority ? "danger" : "") + '">Freeze authority ' + (freezeAuthority ? "active" : "revoked") + '</span>';
    const changes = pair?.priceChange || {};
    const pairLink = (typeof pair?.url === "string" && pair.url.startsWith("https://dexscreener.com/") ? pair.url : null) || ("https://dexscreener.com/solana/" + encodeURIComponent(pair?.pairAddress || ""));
    return '<div class="row spread"><div><div class="market-section-label">SELECTED ASSET</div><h3>' + esc(token?.name || pair?.baseToken?.name || token?.symbol || "Solana token") + ' <span class="muted">' + esc(token?.symbol || pair?.baseToken?.symbol || "") + '</span></h3></div><button class="ghost" id="market-watch">' + (isWatched(mint) ? "★ Watching" : "☆ Watch") + '</button></div>' +
      '<div class="market-detail-price">' + num(pair?.priceUsd ?? token?.usdPrice) + ' <span class="' + pctClass(changes.h24) + '">' + pct(changes.h24) + ' · 24h</span></div>' +
      '<div class="market-detail-grid"><div><small>Liquidity</small><b>' + num(liq) + '</b></div><div><small>24h volume</small><b>' + num(vol) + '</b></div><div><small>Market cap / FDV</small><b>' + num(mcap) + '</b></div><div><small>Holders</small><b>' + (token?.holderCount ? Number(token.holderCount).toLocaleString() : "—") + '</b></div><div><small>5m change</small><b class="' + pctClass(changes.m5) + '">' + pct(changes.m5) + '</b></div><div><small>1h change</small><b class="' + pctClass(changes.h1) + '">' + pct(changes.h1) + '</b></div></div>' +
      '<div class="risk-list">' + flags + '</div>' +
      '<p class="muted market-caveat">Signals are screening indicators, not a safety guarantee. Organic score is unavailable without a verified provider. Always inspect liquidity, holder concentration and contract authorities before taking risk.</p>' +
      '<div class="row spread chart-heading"><b>Price history</b><span class="muted small">' + esc(pair?.dexId || "Pool chart") + '</span></div>' +
      '<div class="chart-controls"><button data-chart="minute:5" class="' + (state.chart === "minute:5" ? "active" : "") + '">5m</button><button data-chart="hour:1" class="' + (state.chart === "hour:1" ? "active" : "") + '">1h</button><button data-chart="day:1" class="' + (state.chart === "day:1" ? "active" : "") + '">1D</button></div>' +
      '<div id="market-chart" class="market-chart"><div class="empty">Loading chart…</div></div>' +
      '<div class="market-detail-actions"><button class="ghost" id="market-copy">Copy mint</button><a target="_blank" rel="noopener noreferrer" href="' + esc(pairLink) + '">Open on DEX Screener ↗</a></div>' +
      '<div class="mono small market-mint">' + esc(mint) + '</div>';
  }
  function renderDetail() {
    const wrap = $("market-detail");
    if (!wrap) return;
    if (!state.selected || !state.detail) {
      wrap.innerHTML = '<div class="empty">Select any token to inspect its market data, liquidity, activity and chart.</div>';
      return;
    }
    const p = state.detail.pairs?.[0] || null;
    wrap.innerHTML = detailMarkup(state.detail.token, p);
    $("market-watch").onclick = () => toggleWatch(state.selected);
    $("market-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(state.selected); setStatus("MINT COPIED","ok"); }
      catch { setStatus("COPY NOT AVAILABLE","warn"); }
    };
    wrap.querySelectorAll("[data-chart]").forEach(b => b.addEventListener("click", () => {
      state.chart = b.dataset.chart;
      renderDetail();
    }));
    if (p?.pairAddress) loadChart(p.pairAddress);
    else $("market-chart").innerHTML = '<div class="empty">No indexed liquidity pool was returned for this token.</div>';
  }
  async function loadChart(pool) {
    const target = $("market-chart");
    if (!target || !pool) return;
    const parts = state.chart.split(":");
    try {
      const d = await api("/api/market/chart?pool=" + encodeURIComponent(pool) + "&timeframe=" + parts[0] + "&aggregate=" + parts[1]);
      const candles = Array.isArray(d.candles) ? d.candles.slice().sort((a,b) => Number(a[0])-Number(b[0])) : [];
      const points = candles.map(x => ({t:Number(x[0]), c:Number(x[4])})).filter(x => Number.isFinite(x.c) && x.c > 0);
      if (points.length < 2) {
        target.innerHTML = '<div class="empty">Chart history is not available for this pool yet.</div>';
        return;
      }
      const min = Math.min(...points.map(x => x.c));
      const max = Math.max(...points.map(x => x.c));
      const span = max - min || max * .01 || 1;
      const coords = points.map((x,i) => {
        const px = 12 + i * 976 / (points.length - 1);
        const py = 12 + (max - x.c) / span * 156;
        return [px, py];
      });
      const path = coords.map((p,i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const last = points[points.length - 1];
      target.innerHTML = '<svg class="market-chart-svg" viewBox="0 0 1000 190" role="img" aria-label="Token price history"><defs><linearGradient id="market-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#91e4b7" stop-opacity=".28"/><stop offset="100%" stop-color="#91e4b7" stop-opacity="0"/></linearGradient></defs><path d="' + path + ' L 988 188 L 12 188 Z" fill="url(#market-chart-fill)"/><path d="' + path + '" fill="none" stroke="#91e4b7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="row spread muted small"><span>' + new Date(points[0].t * 1000).toLocaleString() + '</span><b>Last close ' + num(last.c) + '</b><span>' + new Date(last.t * 1000).toLocaleString() + '</span></div>';
    } catch (e) {
      target.innerHTML = '<div class="empty">Chart provider unavailable. The market snapshot is still shown above.</div>';
    }
  }
  async function openToken(mint) {
    if (!mint) return;
    state.selected = mint;
    $("market-detail").innerHTML = '<div class="empty">Loading token details…</div>';
    try {
      state.detail = await api("/api/market/token?mint=" + encodeURIComponent(mint));
      renderDetail();
    } catch (e) {
      state.detail = null;
      $("market-detail").innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  async function loadFeed(feed = state.feed) {
    state.feed = feed;
    document.querySelectorAll("[data-market-feed]").forEach(b => b.classList.toggle("active", b.dataset.marketFeed === feed));
    setStatus("UPDATING…","warn");
    try {
      const [feedResult, priceResult] = await Promise.allSettled([
        api("/api/market/feeds?feed=" + encodeURIComponent(feed)),
        api("/api/market/price?mint=" + encodeURIComponent(SOL_MINT))
      ]);
      if (feedResult.status !== "fulfilled") throw feedResult.reason;
      const d = feedResult.value;
      const p = priceResult.status === "fulfilled" ? priceResult.value : {};
      state.items = d.items || [];
      state.lastGood = d.fetchedAt || new Date().toISOString();
      const sol = p.price?.usdPrice ?? p.price?.price ?? null;
      $("market-sol-price").textContent = sol === null ? "—" : num(sol);
      $("market-sol-change").textContent = p.price?.priceChange24h === undefined ? "—" : pct(p.price.priceChange24h);
      $("market-sol-change").className = "metric-change " + pctClass(p.price?.priceChange24h);
      $("market-updated").textContent = "UPDATED " + new Date(state.lastGood).toLocaleTimeString();
      $("market-source").textContent = d.source + " · " + d.label;
      renderFeed();
      setStatus("DATA RECEIVED","ok");
    } catch (e) {
      setStatus("DATA DELAYED","bad");
      $("market-updated").textContent = "Waiting for market API";
      if (!state.items.length) empty("Market service may be waking from its free-tier idle state. Retry shortly. " + e.message);
    }
  }
  async function search() {
    const q = $("market-search").value.trim();
    if (q.length < 2) return;
    $("market-search-results").innerHTML = '<div class="empty">Searching DEX Screener token index…</div>';
    try {
      const d = await api("/api/market/search?q=" + encodeURIComponent(q));
      const items = d.items || [];
      if (!items.length) {
        $("market-search-results").innerHTML = '<div class="empty">No tokens found for that search.</div>';
        return;
      }
      $("market-search-results").innerHTML = items.slice(0,8).map(t =>
        '<button class="market-search-result" type="button" data-search-mint="' + esc(tokenId(t)) + '"><b>' + esc(t.name || t.symbol || "Token") + '</b><small>' + esc(t.symbol || "") + ' · ' + esc(tokenId(t)) + '</small></button>'
      ).join("");
      $("market-search-results").querySelectorAll("[data-search-mint]").forEach(b => b.addEventListener("click", () => openToken(b.dataset.searchMint)));
    } catch (e) {
      $("market-search-results").innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  async function loadWatchlist() {
    const list = getWatchlist();
    $("market-watchlist").innerHTML = list.length
      ? list.map(m => '<button class="market-watch-item" data-watch-mint="' + esc(m) + '">' + esc(m.slice(0,6) + "…" + m.slice(-5)) + '</button>').join("")
      : '<span class="muted small">No saved tokens yet. Open a token and choose Watch.</span>';
    $("market-watchlist").querySelectorAll("[data-watch-mint]").forEach(b => b.addEventListener("click", () => openToken(b.dataset.watchMint)));
  }
  function installTabs() {
    document.querySelectorAll("[data-tab]").forEach(b => {
      b.onclick = () => {
        document.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x === b));
        document.querySelectorAll('main > section[id^="tab-"]').forEach(s => s.classList.toggle("hidden", s.id !== "tab-" + b.dataset.tab));
        if (b.dataset.tab === "market") {
          loadWatchlist();
          if (!state.lastGood) loadFeed();
        }
      };
    });
    document.querySelectorAll("[data-wallet-tab]").forEach(b => {
      b.onclick = () => {
        document.querySelectorAll("[data-wallet-tab]").forEach(x => x.classList.toggle("active", x === b));
        ["assets","activity","context","security"].forEach(t => $("tab-" + t).classList.toggle("hidden", t !== b.dataset.walletTab));
      };
    });
  }
  function start() {
    if (!$("market-list")) return;
    installTabs();
    document.querySelectorAll("[data-market-feed]").forEach(b => b.addEventListener("click", () => loadFeed(b.dataset.marketFeed)));
    $("market-refresh").addEventListener("click", () => loadFeed());
    $("market-min-liquidity").addEventListener("change", renderFeed);
    $("market-search-button").addEventListener("click", search);
    $("market-search").addEventListener("keydown", e => { if (e.key === "Enter") search(); });
    loadFeed();
    state.timer = setInterval(() => {
      const marketTab = $("tab-market");
      if (marketTab && !marketTab.classList.contains("hidden") && !document.hidden) loadFeed();
    }, 45000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();