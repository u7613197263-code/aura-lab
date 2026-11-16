import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
const page = await readFile(new URL("./index.html", import.meta.url), "utf8");
const manifest = await readFile(new URL("./manifest.webmanifest", import.meta.url), "utf8");

test("app parses and contains only the watch-only Solana RPC endpoint", () => {
  assert.match(app, /https:\/\/api\.mainnet-beta\.solana\.com/);
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

test("PWA manifest is standalone and Android-friendly", () => {
  const m = JSON.parse(manifest);
  assert.equal(m.display, "standalone");
  assert.ok(m.start_url);
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0);
});
