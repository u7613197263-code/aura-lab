# AURA Market — Approved Standalone Product Plan

**Plan version:** 1.0.0 | **Decision:** approved by owner, 2026-11-17 | **Delivery status:** partial; read acceptance gates below

## 1. Product decision

AURA Market is a **separate, Android-installable, public experimental market-research PWA**. It is not an embedded wallet tab, a private AURA OS release, a hosted autonomous trading agent or a claim that model weights improve through chat.

Reference implementation: AURA Crypto Signal Lab 0.2.4 on the `crypto-signal-lab` branch. Its original deployed build and device-local data must not be overwritten. The standalone implementation is isolated on `feat/aura-market-standalone-v1`, tracked by draft PR #2.

## 2. Five focused app screens

| Screen | User's decision / job |
| --- | --- |
| **Pulse** | What is actually happening within the *observed discovery sample*? See market breadth, research eligibility, data coverage and top research candidates before touching any filter |
| **Discover** | Search, filter, compare and sort source-backed Solana token markets; no irrelevant Wallet UI |
| **Research** | Inspect one asset at a time: transparent screening rationale, 1h/24h momentum, liquidity and flow, risk warnings, on-chain diagnostics, source-based price history |
| **Outcomes** | Verify what happened after a prediction/signal: 5m, 15m, 1h, 6h, 24h tracked forward outcomes; count missed windows explicitly; separate local and public sampler |
| **Paper** | Simulate entries and exits using a phone-local ledger, conservative fee/slippage assumptions and an explicit position-size constraint |

**Method & Privacy** is reached through the top header, not a sixth competing bottom-navigation control.

## 3. Intelligence contract

### Working now (implemented)
- A deterministic explainable Candidate Radar on an available DEX Screener *promotional/profiled discovery sample*. Sampling bias is explicit, and scores never represent the whole Solana market.
- A consistent scoring function used by both candidate list and scanner. Evidence dimensions include liquidity, volume, transaction counts, 1h/24h change, pool age and promotion status. Missing mandatory observations lead to an unscorable result.
- Hard research gates for illiquid, too young or highly volatile pools; positive observed momentum **never** implies expected profit.
- Research dossier states observations, warnings, missing fields and conditional changes in bias. Original wallet-free on-chain diagnostics and historical OHLCV integration remain available subject to provider access.
- Existing phone-local paper portfolio, research exports and explicit forward-outcome ledger.
- Separate Android PWA shell and saved home-screen identity, mobile bottom navigation with 44px+ targets and reduced-motion styling.

### Not yet a trained prediction engine
No calibrated price forecast, profit probability, verified predictive advantage, fully historical backtest, unrestricted global market surveillance, real-time push alerting, or automatically trading system is claimed. These require empirical evidence and additional implementation.

## 4. Release gates & scope

| Gate | Required evidence | Current status |
| --- | --- | --- |
| R0 | Standalone branch, new free Render static service, read-only backend chart permission | Implemented |
| R1 | JavaScript syntax, unique screen structure, deterministic positive/negative/unknown scoring regressions, legacy feature preservation | Tested via Render build; verify latest exact SHA |
| R2 | Live API and UI in an actual browser on Android: screen navigation, scan, search, research chart, paper trade, export/import | Not yet verified |
| R3 | Simulated trade round trip; reload and local ledger restore; no invalid numbers or loss of paper state | Not yet verified |
| R4 | Forward outcomes, source timestamps, stale data and provider downtime shown honestly | Partial; further tests required |
| R5 | Source review of shared public API and security, private/public boundary proof | Partial; PR stays draft |

**Stop condition:** No merge into `crypto-signal-lab`, no replacement of the original user's installed PWA, no private repo modifications, and no claim of forecast accuracy until relevant gates pass.

## 5. Planned future engineering order

1. **Reliability:** improve provider fallback, prevent duplicate requests, bind UI to sampling time and provenance; handle HTTP 429 and CORS gracefully.
2. **Research quality:** independent contract-authority, holder concentration and liquidity-pool provenance verification; invalidate ambiguous claims.
3. **Forward validation:** stable observation IDs, fair sampling, explicit failed/missing windows, instrument fees and slippage, include baselines.
4. **Calibrated forecasting (conditional):** sufficient archived history, walk-forward holdouts, leakage prevention, uncertainty intervals, calibration, drawdown and net-of-cost performance. Ship only if better than simple baselines on unseen observations.
5. **Broader universe:** add Ethereum and other markets only after comparable data contracts are verified and provider access remains within €0.
6. **Optional monitoring:** scheduling or notifications require a separate bounded authority review; no always-on agent or spend is implied.

## 6. Data protection, budget and ownership

- No wallet connect, private key, seed phrase, real transaction signing, order submission or financial transfers.
- Market-provider metadata are untrusted input. Only valid Solana mint addresses may be used as token identifiers.
- Phone-local browser storage is origin-specific. The original installed app's paper ledger **does not automatically migrate** to this new URL; use original app's backup export, then import locally in this app.
- Market reads may reveal observed public market queries to public data providers; no private AURA OS memory or secrets belong in the public repo.
- Public experiment: `u7613197263-code/aura-lab`; original AURA core: `u7613197263-code/aura-os` remains private and unchanged.
- Incremental monthly infrastructure/API budget: **€0**. Existing Render Free services and public/no-key providers only.
- Rollback: preserve original Crypto Signal Lab build, keep PR #2 draft, use Render deployment history to revert this standalone site only if needed.

## 7. Master plan integration (proposal only)

Add a separate **AURA Market / Public Experimental Product** workstream under AURA OS product roadmap, explicitly decoupled from private runtime F0–F7 security milestones. Keep market predictions and externally observable data separate from canonical private memory/event contract. Do not mark the entire private AURA core as deployed because this PWA exists.

**Current master-plan state:** NOT WRITTEN. Integrate a versioned reviewed update only after Android and data-provider acceptance gates.
