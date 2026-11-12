require("dotenv").config();
const express = require("express");
const API = "https://1click.chaindefuser.com/v0";
// USDC on NEAR (the seller always receives this)
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const { ONECLICK_JWT, MERCHANT_NEAR_ACCOUNT, FEE_BPS, FEE_RECIPIENT } = process.env;
const { neon } = require("@neondatabase/serverless");
const PRIVY_APP_ID = process.env.PRIVY_APP_ID || "cmwaflyog00o30hjsmoppvmnr";
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let ready;
function db() {
  if (!sql) throw new Error("no database");
  ready = ready || (async () => {
    await sql`CREATE TABLE IF NOT EXISTS merchants (user_id text PRIMARY KEY, near_account text NOT NULL, updated_at timestamptz DEFAULT now())`;
    await sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shop_name text`;
    await sql`CREATE TABLE IF NOT EXISTS payments (deposit_address text PRIMARY KEY, pay_to text NOT NULL, usd numeric NOT NULL, origin_asset text, status text DEFAULT 'PENDING', created_at timestamptz DEFAULT now())`;
    await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer text`;
    await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_to text`;
    await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS shop text`;
    await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS nft_state text`;
    await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS nft_tx text`;
    await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS nft_tries int DEFAULT 0`;
    await sql`CREATE INDEX IF NOT EXISTS payments_pay_to ON payments (pay_to, created_at DESC)`;
  })().catch(e => { ready = null; throw e; });
  return ready.then(() => sql);
}

// Check the Privy sign-in token the browser sends
let jwks;
async function auth(req, res, next) {
  try {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    jwks = jwks || createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`));
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const { payload } = await jwtVerify(token, jwks, { issuer: "privy.io", audience: PRIVY_APP_ID });
    req.userId = payload.sub;
    next();
  } catch (e) { res.status(401).json({ error: "Please sign in again." }); }
}

const app = express();
app.use(express.json());
app.use(express.static("public"));

// A named NEAR account, like yourname.near
const NEAR_NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.near$/;
const NEAR_RPCS = ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"];

// Check that a .near account exists before a merchant saves it
async function checkAccount(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (id.length > 64 || !NEAR_NAME.test(id)) return { code: 400, error: "Enter a NEAR account that ends in .near, like yourname.near." };
  for (const rpc of NEAR_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }),
        signal: AbortSignal.timeout(6000),
      });
      const j = await r.json();
      if (j.result) return { id };
      if (/UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j.error || {}))) return { code: 404, error: "This account was not found on NEAR. Check the spelling." };
    } catch (e) { /* try the next server */ }
  }
  return { code: 503, error: "Could not check right now. Try again in a moment." };
}

app.get("/api/account", async (req, res) => {
  const r = await checkAccount(req.query.id);
  if (r.error) return res.status(r.code).json({ ok: false, error: r.error });
  res.json({ ok: true });
});

// The merchant's saved account
app.get("/api/me", auth, async (req, res) => {
  try {
    const q = await db();
    const rows = await q`SELECT near_account, shop_name FROM merchants WHERE user_id = ${req.userId}`;
    res.json({ account: rows[0]?.near_account || null, shop: rows[0]?.shop_name || "" });
  } catch (e) { res.status(503).json({ error: "Could not load your account." }); }
});
app.put("/api/me", auth, async (req, res) => {
  const r = await checkAccount(req.body?.account);
  if (r.error) return res.status(r.code).json({ ok: false, error: r.error });
  try {
    const shop = String(req.body?.shop || "").trim().slice(0, 40);
    const q = await db();
    await q`INSERT INTO merchants (user_id, near_account, shop_name) VALUES (${req.userId}, ${r.id}, ${shop}) ON CONFLICT (user_id) DO UPDATE SET near_account = ${r.id}, shop_name = ${shop}, updated_at = now()`;
    res.json({ ok: true, account: r.id, shop });
  } catch (e) { res.status(503).json({ ok: false, error: "Could not save right now. Try again." }); }
});
app.delete("/api/me", auth, async (req, res) => {
  try { const q = await db(); await q`DELETE FROM merchants WHERE user_id = ${req.userId}`; res.json({ ok: true }); }
  catch (e) { res.status(503).json({ ok: false }); }
});

// Payment history for the signed-in merchant's account
app.get("/api/payments", auth, async (req, res) => {
  try {
    const q = await db();
    const m = await q`SELECT near_account FROM merchants WHERE user_id = ${req.userId}`;
    if (!m[0]) return res.json({ payments: [] });
    const rows = await q`SELECT deposit_address, usd, status, created_at, customer, nft_tx FROM payments WHERE pay_to = ${m[0].near_account} ORDER BY created_at DESC LIMIT 50`;
    res.json({ payments: rows });
  } catch (e) { res.status(503).json({ error: "Could not load history." }); }
});

const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${ONECLICK_JWT}` });
let tokenCache = { at: 0, data: [] };

app.get("/api/tokens", async (_req, res) => {
  try {
    if (Date.now() - tokenCache.at > 10 * 60 * 1000) {
      const r = await fetch(`${API}/tokens`, { headers: headers() });
      const list = await r.json();
      tokenCache = { at: Date.now(), data: list.map(t => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, decimals: t.decimals })) };
    }
    res.json(tokenCache.data);
  } catch (e) { res.status(500).json({ error: "Could not load tokens." }); }
});

app.post("/api/quote", async (req, res) => {
  try {
    const { amount, originAsset, refundTo, to } = req.body;
    const customer = String(req.body.customer || "").trim().slice(0, 60);
    const shop = String(req.body.shop || "").trim().slice(0, 40);
    const rt = String(req.body.receiptTo || "").trim().toLowerCase();
    const receiptTo = rt && rt.length <= 64 && NEAR_NAME.test(rt) ? rt : null;
    const payTo = typeof to === "string" && to.length <= 64 && NEAR_NAME.test(to) ? to : MERCHANT_NEAR_ACCOUNT;
    const usd = Number(amount);
    if (!(usd > 0 && usd <= 10000)) return res.status(400).json({ error: "Amount must be between 0 and 10,000." });
    if (!originAsset || !refundTo) return res.status(400).json({ error: "Pick a token and enter a refund address." });
    if (!payTo) return res.status(500).json({ error: "Seller account is not set." });
    const body = {
      dry: false,
      depositMode: "SIMPLE",
      swapType: "EXACT_OUTPUT",          // seller gets exactly this much USDC
      slippageTolerance: 100,            // 1%
      originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_NEAR,
      amount: String(Math.round(usd * 1e6)), // USDC has 6 decimals
      refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: payTo,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 3000,
    };
    if (FEE_BPS && FEE_RECIPIENT) body.appFees = [{ recipient: FEE_RECIPIENT, fee: Number(FEE_BPS) }];
    const r = await fetch(`${API}/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || "Quote failed." });
    const q = data.quote;
    try {
      const d = await db();
      await d`INSERT INTO payments (deposit_address, pay_to, usd, origin_asset, customer, receipt_to, shop) VALUES (${q.depositAddress}, ${payTo}, ${usd}, ${originAsset}, ${customer}, ${receiptTo}, ${shop}) ON CONFLICT DO NOTHING`;
    } catch (e) { /* history is optional; never block a payment */ }
    res.json({ depositAddress: q.depositAddress, amountIn: q.amountInFormatted || q.amountIn, deadline: q.deadline || data.quoteRequest?.deadline, memo: q.memo || null });
  } catch (e) { res.status(500).json({ error: "Could not get a quote." }); }
});

// ---- NFT receipt (Mintbase store on NEAR) ----
const { MINTBASE_STORE, MINTER_ACCOUNT, MINTER_KEY } = process.env;
const BASE_URL = process.env.PUBLIC_URL || "https://bexley-pay.vercel.app";
let minter;
async function getMinter() {
  if (!minter) {
    const { connect, keyStores, KeyPair } = require("near-api-js");
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey("mainnet", MINTER_ACCOUNT, KeyPair.fromString(MINTER_KEY));
    const near = await connect({ networkId: "mainnet", keyStore, nodeUrl: NEAR_RPCS[0] });
    minter = await near.account(MINTER_ACCOUNT);
  }
  return minter;
}
// Mint one receipt NFT for a paid order. Safe to call twice: only one call can win the lock.
async function mintReceipt(depositAddress) {
  if (!sql || !MINTBASE_STORE || !MINTER_ACCOUNT || !MINTER_KEY) return null;
  const q = await db();
  const rows = await q`UPDATE payments SET nft_state = 'minting', nft_tries = nft_tries + 1 WHERE deposit_address = ${depositAddress} AND status = 'SUCCESS' AND nft_tx IS NULL AND (nft_state IS NULL OR nft_state = 'failed') AND nft_tries < 3 RETURNING pay_to, receipt_to, usd, customer, shop, created_at`;
  if (!rows[0]) return null;
  const p = rows[0];
  try {
    const acct = await getMinter();
    const id = encodeURIComponent(depositAddress);
    const result = await acct.functionCall({
      contractId: MINTBASE_STORE,
      methodName: "nft_batch_mint",
      args: {
        owner_id: p.receipt_to || p.pay_to,
        metadata: {
          title: `Bexley Pay receipt, $${Number(p.usd).toFixed(2)}`,
          description: `Paid $${Number(p.usd).toFixed(2)} USDC to ${p.shop || p.pay_to} (${p.pay_to})${p.customer ? ", invoice for " + p.customer : ""}. Paid with NEAR Intents.`,
          media: `${BASE_URL}/api/receipt-image?id=${id}`,
          reference: `${BASE_URL}/api/receipt-image?id=${id}`,
          extra: "receipt",
        },
        num_to_mint: 1,
        royalty_args: null,
        split_owners: null,
      },
      gas: BigInt("200000000000000"),
      attachedDeposit: BigInt(1),
    });
    const tx = result.transaction?.hash || result.transaction_outcome?.id;
    await q`UPDATE payments SET nft_state = 'done', nft_tx = ${tx} WHERE deposit_address = ${depositAddress}`;
    return tx;
  } catch (e) {
    console.error("mint failed", e.message);
    try { await q`UPDATE payments SET nft_state = 'failed' WHERE deposit_address = ${depositAddress}`; } catch (_) {}
    return null;
  }
}

const esc = t => String(t || "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
// The picture on the receipt NFT
app.get("/api/receipt-image", async (req, res) => {
  try {
    const q = await db();
    const r = (await q`SELECT pay_to, usd, customer, shop, created_at FROM payments WHERE deposit_address = ${String(req.query.id || "")} AND status = 'SUCCESS'`)[0];
    if (!r) return res.status(404).send("Not found");
    const date = new Date(r.created_at).toISOString().slice(0, 10);
    res.set("Content-Type", "image/svg+xml").set("Cache-Control", "public, max-age=3600").send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400"><rect width="640" height="400" rx="28" fill="#050505"/><svg x="40" y="40" width="48" height="48" viewBox="0 0 64 64"><rect x="0.5" y="0.5" width="63" height="63" rx="14" fill="#050505" stroke="#232823" stroke-width="1"/><rect x="15" y="11" width="8" height="42" rx="2.5" fill="#12C47A"/><rect x="23" y="25" width="24" height="24" rx="6" fill="none" stroke="#12C47A" stroke-width="8"/><rect x="31" y="33" width="8" height="8" rx="2" fill="#12C47A"/></svg><text x="104" y="74" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="600" fill="#f2f2f2">Bexley Pay receipt</text><text x="40" y="190" font-family="Helvetica,Arial,sans-serif" font-size="72" font-weight="700" fill="#12C47A">$${esc(Number(r.usd).toFixed(2))}</text><text x="40" y="250" font-family="Helvetica,Arial,sans-serif" font-size="24" fill="#f2f2f2">Paid to ${esc(r.shop || r.pay_to)}</text><text x="40" y="285" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#8a8f8a">${esc(r.pay_to)}</text>${r.customer ? `<text x="40" y="320" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#8a8f8a">Invoice for ${esc(r.customer)}</text>` : ""}<text x="40" y="365" font-family="Helvetica,Arial,sans-serif" font-size="16" fill="#8a8f8a">${date} · USDC on NEAR · via NEAR Intents</text></svg>`);
  } catch (e) { res.status(503).send("Unavailable"); }
});

app.get("/api/status", async (req, res) => {
  try {
    const r = await fetch(`${API}/status?depositAddress=${encodeURIComponent(req.query.depositAddress || "")}`, { headers: headers() });
    const d = await r.json();
    let nft = null;
    if (d.status && sql) {
      const dep = String(req.query.depositAddress || "");
      try {
        const q = await db();
        await q`UPDATE payments SET status = ${d.status} WHERE deposit_address = ${dep}`;
        if (d.status === "SUCCESS") {
          nft = await mintReceipt(dep);
          if (!nft) nft = (await q`SELECT nft_tx FROM payments WHERE deposit_address = ${dep}`)[0]?.nft_tx || null;
        }
      } catch (e) {}
    }
    res.json({ status: d.status, nft });
  } catch (e) { res.status(500).json({ error: "Could not check status." }); }
});

// Run as a normal server on your Mac or Render. On Vercel the app is loaded from api/index.js instead.
if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => console.log("Bexley Pay running on http://localhost:3000"));
}
module.exports = app;
