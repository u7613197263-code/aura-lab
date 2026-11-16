# Changelog

## 0.2.4

- Added a public GitHub Actions market sampler on a best-effort five-minute schedule.
- Added shared public ledger with baseline observations and 5m/15m/1h/6h/24h forward outcomes.
- Added global sampler status, freshness, tracked-asset and outcome panels to Prediction Lab.
- Added local tracked-mint refresh independent of new-token discovery feeds.
- Added grace windows and explicit missed-sample states; delayed prices are not retroactively assigned to earlier horizons.
- Included active paper positions in local mark refreshes.
- Bumped service-worker cache to `aura-crypto-shell-024`.
- Kept paper trading simulation-only; no wallet signing or real orders.

## 0.2.2

- Fixed missing `clamp` function that interrupted post-scan rendering.
- Separated application errors from provider availability.
- Added network status and fallback FX provider.
- Improved narrow-screen table layout.
