require("dotenv").config();
const express = require("express");
const API = "https://1click.chaindefuser.com/v0";
// USDC on NEAR (the seller always receives this)
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const { ONECLICK_JWT, MERCHANT_NEAR_ACCOUNT, FEE_BPS, FEE_RECIPIENT } = process.env;
const app = express();
app.use(express.json());
app.use(express.static("public"));

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
    const OK = /^(?:[a-f0-9]{64}|[a-z0-9]+(?:[-_.][a-z0-9]+)*)$/;
    const payTo = to && to.length >= 2 && to.length <= 64 && OK.test(to) ? to : MERCHANT_NEAR_ACCOUNT;
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
    res.json({ depositAddress: q.depositAddress, amountIn: q.amountInFormatted || q.amountIn, deadline: q.deadline || data.quoteRequest?.deadline, memo: q.memo || null });
  } catch (e) { res.status(500).json({ error: "Could not get a quote." }); }
});

app.get("/api/status", async (req, res) => {
  try {
    const r = await fetch(`${API}/status?depositAddress=${encodeURIComponent(req.query.depositAddress || "")}`, { headers: headers() });
    const d = await r.json();
    res.json({ status: d.status });
  } catch (e) { res.status(500).json({ error: "Could not check status." }); }
});

app.listen(process.env.PORT || 3000, () => console.log("Bexley Pay running on http://localhost:3000"));
