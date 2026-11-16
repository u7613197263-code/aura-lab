# AURA Wallet Intelligence 0.1.1

Android-first, watch-only Solana wallet monitor. Static PWA; no backend, wallet connection, signing, custody, trade execution or automated selling.

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
- No market prices or cost basis are calculated. No profitability claims are made.
- RPC failures retain the last local snapshot; stale state is clearly labelled.
- No scheduled/background data collection or alerts.

## Run
Serve this directory over HTTPS (or localhost for development). On Android Chrome use **Install app** / **Add to Home screen**.
