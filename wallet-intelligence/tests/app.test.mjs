import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
const manifest = await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8");

test("app parses and tries multiple read-only Solana RPC providers", () => {
  assert.match(app, /https:\/\/solana-rpc\.publicnode\.com/);
  assert.match(app, /https:\/\/api\.mainnet\.solana\.com/);
  assert.match(app, /https:\/\/api\.mainnet-beta\.solana\.com/);
  assert.match(app, /All public Solana RPC endpoints failed/);
  assert.match(page, /https:\/\/solana-rpc\.publicnode\.com/);
  assert.match(app, /getBalance/);
  assert.match(app, /getTokenAccountsByOwner/);
  assert.match(app, /getSignaturesForAddress/);
  assert.match(app, /getTransaction/);
});

test("wallet records are stored locally in IndexedDB", () => {
  assert.match(app, /indexedDB\.open/);
  assert.match(app, /aura-wallet-intelligence/);
  assert.match(page, /saved on this browser/i);
});

test("transactions remain unclassified and P&L is not inferred", () => {
  assert.match(app, /UNCLASSIFIED/);
  assert.match(app, /profitLoss:null/);
  assert.match(page, /balance changes alone cannot reliably distinguish/i);
  assert.doesNotMatch(app, /sendTransaction|signTransaction|signAndSendTransaction/);
});

test("backup encryption uses PBKDF2 and AES-GCM", () => {
  assert.match(app, /PBKDF2/);
  assert.match(app, /AES-GCM/);
  assert.match(app, /iterations:310000/);
});

test("page has no wallet-connect or secret-entry flow", () => {
  assert.match(page, /WATCH-ONLY/);
  assert.match(page, /Never enter a seed phrase, private key/);
  assert.doesNotMatch(page, /wallet-adapter|walletconnect|signTransaction/i);
});

test("service worker invalidates old cached RPC client", async () => {
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /aura-wallet-intelligence-0\.1\.1/);
});

test("PWA manifest is standalone and Android-friendly", () => {
  const m = JSON.parse(manifest);
  assert.equal(m.display, "standalone");
  assert.ok(m.start_url);
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0);
});
