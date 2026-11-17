# AURA Market & Wallet Intelligence v0.3.1

Android-first, read-only Solana market observatory and local-only watch-wallet PWA. The market and wallet paths are separate. No wallet connection, signing, custody, trade execution, token transfer, private keys or automated trading.

## Intelligence / Candidate Radar

- The scanner observes whichever **provider-curated feed sample** is currently selected; it does not claim to rank every asset in Solana.
- Each token with sufficient data receives an explainable heuristic score (0–100). Weights: liquidity up to 30, volume up to 20, observed 1h/24h momentum up to 20, buy/sell count balance up to 15, and pool age up to 15. Risk penalties apply.
- Top **research candidates** must have a valid price, sufficient data, pool liquidity ≥$25,000, observed 24h volume ≥$10,000, pool age ≥24h and no extreme-turnover / rapid-spike / severe-drawdown flags.
- Confidence/coverage displays observed fields and explicit missing fields. If evidence is insufficient the score is null.
- **Market Outlook** is an observed, conditional momentum classification: positive, mixed, weakening or unknown. It is **not a return forecast**, profit probability, recommendation, backtested investment strategy, contract audit or guarantee of token safety.
- Data coverage, market breadth, ranked observations and evidence explanations are calculated from actual API samples. Never substitute dummy tokens or fabricate missing values.

## Market data and resilient access

- Read-only Node API hosted separately on Render Free: `../wallet-intelligence-api/server.mjs`.
- Primary provider: GeckoTerminal public trending and new Solana pools, including price, liquidity, 24h volume, transaction counts, pool age and 1h/24h price change where available.
- Token details, search and SOL USD price: DEX Screener free API. Historical OHLCV charts: GeckoTerminal.
- GeckoTerminal public endpoints are rate-limited; the backend deduplicates overlapping requests, caches provider snapshots, and pauses calls during a 429 cooldown.
- If GeckoTerminal fails, a **source-stamped last-good snapshot** (up to 5 minutes old) may be shown, clearly marked stale. If none is available, the backend may use DEX Screener's latest boosted or profiled tokens as an **explicitly labeled promotional/profiled sample**. This backup is not a market-wide trending feed and carries selection bias.
- The server cannot promise uninterrupted availability, complete market coverage or fixed delivery latency. Render Free instances can sleep, providers may block IPs, change schemas or throttle calls.
- Distinguish provider observation time, cached time, and stale/fallback state in user-facing displays.
- Market list controls: provider feed, search, liquidity filter, watchlist and pool price-history chart.

## Wallet privacy and safety

- Wallet labels, public addresses and cached wallet records remain in local browser IndexedDB; the app does not transmit them to the AURA market API, GitHub, Render or Supabase.
- IndexedDB itself is **not encrypted**. Another person with access to an unlocked browser profile/device can inspect local records.
- Clicking wallet refresh sends the public address and request metadata to a public Solana RPC service: PublicNode, mainnet, then mainnet-beta RPC fallback.
- Reads SOL balance, SPL / Token-2022 accounts and recent transaction signatures. Transaction rows are deliberately `UNCLASSIFIED`. No inferred wallet valuation, swap profit, cost basis or P&L.
- Password-protected backup exports use PBKDF2-SHA256 (310,000 iterations) and AES-256-GCM. Password is never stored or transmitted.
- **Never enter or share seed phrases, private keys, recovery phrases, or exchange secrets.** This PWA has no wallet signing or transaction execution pathways.

## Validation, deployment and boundaries

- GitHub Actions checks Node JavaScript parsing, privacy assumptions, watch-only wallet tests and deterministic intelligence scoring tests.
- Public project: `aura-lab` hosts this static demonstration and public market-data API only. **Private AURA OS source and memory state must not be copied here.**
- Render static service serves `wallet-intelligence/` on the deployment branch; Render API web service runs `node wallet-intelligence-api/server.mjs`.
- Android PWA shell is cache-versioned and network-first, with offline fallback. **Do not clear browser storage** to refresh code; it would erase local wallet snapshots.
- Final acceptance requires a live browser test of provider data, Candidate Radar population and token selection; a successful deployment or health endpoint alone does not prove functionality.
