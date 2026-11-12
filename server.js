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
    const rows = await q`SELECT deposit_address, usd, status, created_at FROM payments WHERE pay_to = ${m[0].near_account} ORDER BY created_at DESC LIMIT 50`;
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
      await d`INSERT INTO payments (deposit_address, pay_to, usd, origin_asset) VALUES (${q.depositAddress}, ${payTo}, ${usd}, ${originAsset}) ON CONFLICT DO NOTHING`;
    } catch (e) { /* history is optional; never block a payment */ }
    res.json({ depositAddress: q.depositAddress, amountIn: q.amountInFormatted || q.amountIn, deadline: q.deadline || data.quoteRequest?.deadline, memo: q.memo || null });
  } catch (e) { res.status(500).json({ error: "Could not get a quote." }); }
});

app.get("/api/status", async (req, res) => {
  try {
    const r = await fetch(`${API}/status?depositAddress=${encodeURIComponent(req.query.depositAddress || "")}`, { headers: headers() });
    const d = await r.json();
    if (d.status && sql) {
      try { const q = await db(); await q`UPDATE payments SET status = ${d.status} WHERE deposit_address = ${String(req.query.depositAddress || "")}`; } catch (e) {}
    }
    res.json({ status: d.status });
  } catch (e) { res.status(500).json({ error: "Could not check status." }); }
});

// Run as a normal server on your Mac or Render. On Vercel the app is loaded from api/index.js instead.
if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => console.log("Bexley Pay running on http://localhost:3000"));
}
module.exports = app;
