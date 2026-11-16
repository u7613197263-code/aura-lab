# AURA Market Sampler

## What it does

A public-data collector for Solana token discovery and forward-price observation. It runs from GitHub Actions on a best-effort five-minute schedule and writes its ledger to `data/market-ledger.json` on the `crypto-signal-lab` branch.

The Android PWA reads that public JSON directly from GitHub raw content. The web page itself is static; the collector is the background component.

## Data flow

1. The workflow runs from the repository's default branch (`main`), as required by GitHub scheduled workflows.
2. The workflow checks out `crypto-signal-lab`.
3. The Node.js sampler queries public DEX Screener feeds: token profiles, boosts, community takeovers and ads.
4. It looks up Solana pairs in batches of up to 30 mints.
5. For discovered assets with valid market data it records a baseline and five outcome windows: 5m, 15m, 1h, 6h and 24h.
6. Later runs refresh due assets independently of the current discovery feeds and record the first valid sample inside each allowed window.
7. The workflow commits the updated JSON ledger back to `crypto-signal-lab`.

## Outcome semantics

- `pending`: target window has not yet arrived or has not yet been sampled.
- `captured`: a valid market price was sampled inside the target's grace window. The return is measured against the baseline price.
- `missed_window`: no valid sample arrived before the sampling deadline.
- `no_market`: the provider no longer returned a market pair before the deadline.

Missed or missing-market outcomes are not treated as zero returns and are excluded from return averages.

## Timing and reliability limits

The workflow is scheduled every five minutes. GitHub Actions schedule events can be delayed during platform load; a five-minute cron is not a real-time guarantee. Scheduled workflows run from the default branch and public-repository schedules can be disabled after prolonged repository inactivity. The app shows the last successful collector time and labels stale data.

The collector records an actual run timestamp and status. A run that fails all provider requests must not advance the last-success timestamp.

## Data sources

- DEX Screener public discovery and token-pair endpoints.
- No wallet connection, private API keys, exchange credentials or paid data feed.
- No user-specific financial data is sent to the collector.

## Validation

The sampler includes six self-test assertions for:
- score bounds,
- five horizons created from a baseline,
- return calculation,
- missed-window behaviour,
- highest-liquidity pair selection,
- merged discovery sources.

The first deployed GitHub Actions run was verified successful. At that initial run it found 65 discovery candidates, added two assets with valid market pairs, and created ten pending outcomes. No outcome had matured yet at that time.

## What it is not

- Not a trading bot and does not place orders.
- Not a calibrated probability model.
- Not proof of positive expected value or profitability.
- Not guaranteed always-on/real-time infrastructure.
- Not a complete smart-contract audit or proof that a token is safe.

## Android app

The public static PWA reads the collector ledger and keeps the user's paper portfolio in browser local storage. Local portfolio data is device/browser-specific; use the in-app JSON backup to preserve it.
