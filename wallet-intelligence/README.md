# AURA Market & Wallet Intelligence 0.2.0

Android-first, watch-only Solana wallet monitor. Android-first static PWA with a read-only market-data API. No wallet connection, signing, custody, trade execution or automated selling.

## Privacy
- Public wallet addresses, labels and snapshots are stored in IndexedDB on this browser origin. They are not uploaded to AURA, Render, GitHub or Supabase.
- IndexedDB is **not application-encrypted**. Anyone with access to the unlocked browser profile/device may inspect local data.
- Refresh sends the public address to the shared Solana public RPC endpoint; the provider can observe the address and request metadata.
- Encrypted exports use PBKDF2-SHA256 (310,000 iterations) and AES-256-GCM. The backup passphrase is never stored or transmitted. If lost, the backup cannot be recovered.
- Never enter a seed phrase, private key, keystore, recovery phrase or exchange secret.

## Data limitations
- Uses ordered public RPC failover: PublicNode (`https://solana-rpc.publicnode.com`), Solana mainnet (`https://api.mainnet.solana.com`), then mainnet-beta (`https://api.mainnet-beta.solana.com`). Each is shared infrastructure; rate limits, CORS/IP blocking and availability can change. No endpoint has an SLA in this app.
- Refresh reads SOL balance, SPL Token and Token-2022 accounts, latest 12 signatures, then attempts transaction detail for each signature.
- All transaction rows remain `UNCLASSIFIED`; no swap/transfer/P&L inference is performed.
- Wallet valuation, cost basis and P&L are not calculated. Market views are separate from wallet reads.
- RPC failures retain the last local snapshot; stale state is clearly labelled.
- Market tab uses Jupiter Tokens/Price, DEX Screener and GeckoTerminal through a same-origin-restricted Render API proxy. It refreshes while open; charts use GeckoTerminal OHLCV and may be delayed by provider caching.
- The Market API is a free Render web service. Free instances can sleep after 15 minutes without inbound traffic and take about one minute to wake. It is not an always-on market data feed or alerting worker.
- Prices and liquidity are market observations, not guaranteed execution prices. Jupiter verification and Organic Score are screening signals, not proof of safety.

## Run
Serve this directory over HTTPS (or localhost for development). On Android Chrome use **Install app** / **Add to Home screen**.

## Market dashboard
- Market and wallet functions are separate. Market reads do not depend on a wallet address or Solana RPC balance refresh.
- Feeds: trending, organic activity, recent pools, and top traded; search; token detail; liquidity/volume/market-cap fields; pool history chart; local token watchlist.
- Upstream APIs are public and rate-limited. Values are source-stamped; stale or missing data must not be treated as live.
- API service folder: `../wallet-intelligence-api/`.
