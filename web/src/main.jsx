import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import QRCode from "qrcode";

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID || "cmwaflyog00o30hjsmoppvmnr";
// A named NEAR account, like yourname.near
const NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.near$/;
const NAME_HELP = "Enter a NEAR account that ends in .near, like yourname.near.";

function label(s) {
  if (s === "SUCCESS") return { t: "Paid", cls: "paid" };
  if (s === "REFUNDED" || s === "FAILED") return { t: s === "FAILED" ? "Failed" : "Refunded", cls: "bad" };
  if (s === "PROCESSING" || s === "KNOWN_DEPOSIT_TX") return { t: "Processing", cls: "wait" };
  return { t: "Waiting", cls: "wait" };
}

function Dashboard() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const [acct, setAcct] = useState("");
  const [saved, setSaved] = useState("");
  const [checking, setChecking] = useState(false);
  const [acctErr, setAcctErr] = useState("");
  const [shop, setShop] = useState("");
  const [f, setF] = useState({ customer: "", amount: "", note: "" });
  const [out, setOut] = useState(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("new");
  const [hist, setHist] = useState(null);

  const key = user ? "bexley_payout_" + user.id : null;
  const email = user?.email?.address || user?.google?.email || "Signed in";

  async function api(path, opts = {}) {
    const token = await getAccessToken();
    const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token } });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  }

  // Load the merchant's saved account from the database
  useEffect(() => {
    if (!authenticated) { setSaved(""); setAcct(""); setLoaded(false); setHist(null); return; }
    (async () => {
      try {
        const { ok, d } = await api("/api/me");
        if (ok && d.account) { setSaved(d.account); setAcct(d.account); setShop(d.shop || ""); }
        else if (!ok) setAcctErr(d.error || "Could not load your account.");
        else { try { const v = key && localStorage.getItem(key); if (v && NAME.test(v)) setAcct(v); } catch (e) {} }
      } catch (e) { setAcctErr("Could not load your account."); }
      setLoaded(true);
    })();
  }, [authenticated, key]);

  async function loadHist() {
    try { const { ok, d } = await api("/api/payments"); if (ok) setHist(d.payments); } catch (e) {}
  }
  useEffect(() => { if (saved) loadHist(); }, [saved]);

  async function verify() {
    setAcctErr("");
    const id = acct.trim().toLowerCase();
    if (id.length > 64 || !NAME.test(id)) return setAcctErr(NAME_HELP);
    setChecking(true);
    try {
      const { ok, d } = await api("/api/me", { method: "PUT", body: JSON.stringify({ account: id, shop: shop.trim() }) });
      if (!ok || !d.ok) setAcctErr(d.error || "Could not save this account.");
      else { setSaved(d.account); setAcct(d.account); setShop(d.shop || ""); }
    } catch (e) { setAcctErr("Could not save right now. Try again."); }
    setChecking(false);
  }
  async function change() {
    setSaved(""); setOut(null); setHist(null);
    try { await api("/api/me", { method: "DELETE" }); } catch (e) {}
  }

  async function make() {
    setErr("");
    if (!saved) return setErr("Add your NEAR account first.");
    if (!(Number(f.amount) > 0)) return setErr("Enter an amount.");
    const u = new URL(location.origin + "/");
    u.searchParams.set("amount", f.amount); u.searchParams.set("to", saved);
    if (f.note) u.searchParams.set("note", f.note);
    if (f.customer.trim()) u.searchParams.set("for", f.customer.trim());
    if (shop) u.searchParams.set("shop", shop);
    setOut({ link: u.href, qr: await QRCode.toDataURL(u.href, { width: 440, margin: 1 }) });
  }
  const set = k => e => setF({ ...f, [k]: e.target.value });

  return (
    <div className="wrap">
      <div className="top"><div className="logo">B</div>Bexley Pay<span className="sp" />
        {authenticated && <button className="ghost link" onClick={logout}>Sign out</button>}</div>
      {!ready || (authenticated && !loaded) ? <p className="mute">Loading…</p> : !authenticated ? (
        <div className="card"><h2>Accept crypto from any chain</h2>
          <p className="mute">Sign in with email or Google. Add your .near account, and customers pay you in USDC from any chain.</p>
          <button onClick={login}>Sign in</button></div>
      ) : (<>
        <div className="card"><p className="mute">{email}</p>
          <label>Your NEAR account (where you get paid)</label>
          {saved ? (<>
            {shop && <p style={{ margin: "0 0 8px", fontWeight: 600 }}>{shop}</p>}
            <div className="addr">{saved}</div>
            <p className="ok" style={{ margin: "10px 0 0" }}>Account found. Payments go here as USDC.</p>
            <button className="ghost" onClick={change}>Change shop or account</button>
          </>) : (<>
            <input value={acct} onChange={e => setAcct(e.target.value)} placeholder="yourname.near" autoCapitalize="none" autoCorrect="off" spellCheck="false" />
            <label>Your shop name (customers see this)</label>
            <input value={shop} onChange={e => setShop(e.target.value)} placeholder="Bexley Gadgets" maxLength={40} />
            <button onClick={verify} disabled={checking}>{checking ? "Checking…" : "Save"}</button>
            {acctErr && <div className="err">{acctErr}</div>}
          </>)}
        </div>
        {saved && <div className="tabs"><button className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>New payment</button><button className={tab === "hist" ? "on" : ""} onClick={() => { setTab("hist"); loadHist(); }}>History</button></div>}
        {saved && tab === "new" && <div className="card"><h2>New payment</h2>
          <label>Invoice for (customer name)</label><input value={f.customer} onChange={set("customer")} placeholder="Ada Okafor" maxLength={60} />
          <label>Amount in USD</label><input type="number" min="1" step="0.01" value={f.amount} onChange={set("amount")} placeholder="40" />
          <label>What is it for?</label><input value={f.note} onChange={set("note")} placeholder="Phone case" />
          <button onClick={make}>Create payment QR</button>
          {err && <div className="err">{err}</div>}
        </div>}
        {saved && tab === "new" && out && <div className="card" style={{ textAlign: "center" }}>
          <p className="mute" style={{ marginBottom: 12 }}>Customer scans this with their phone camera</p>
          <div className="qr"><img src={out.qr} alt="Payment QR" /></div>
          <div className="addr" style={{ textAlign: "left" }}>{out.link}</div>
          <button className="ghost" onClick={() => navigator.clipboard.writeText(out.link)}>Copy link</button></div>}
        {saved && tab === "hist" && <div className="card"><h2>History</h2>
          {hist === null ? <p className="mute">Loading…</p> : hist.length === 0 ? <p className="mute">No payments yet. Payments to {saved} show here.</p> :
            hist.map(p => <div key={p.deposit_address} className="row"><div><b>${Number(p.usd).toFixed(2)}</b><div className="mute sm">{p.customer ? p.customer + " · " : ""}{new Date(p.created_at).toLocaleString()}</div></div><span className={"tag " + label(p.status).cls}>{label(p.status).t}</span></div>)}
          <button className="ghost" onClick={loadHist}>Refresh</button></div>}
      </>)}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <PrivyProvider appId={APP_ID} config={{ loginMethods: ["email", "google"], appearance: { theme: "dark", accentColor: "#2bd96b" } }}>
    <Dashboard />
  </PrivyProvider>
);
