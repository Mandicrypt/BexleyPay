import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import QRCode from "qrcode";

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID || "cmwaflyog00o30hjsmoppvmnr";
// A named NEAR account, like yourname.near
const NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.near$/;
const NAME_HELP = "Enter a NEAR account that ends in .near, like yourname.near.";

function Dashboard() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const [acct, setAcct] = useState("");
  const [saved, setSaved] = useState("");
  const [checking, setChecking] = useState(false);
  const [acctErr, setAcctErr] = useState("");
  const [f, setF] = useState({ shop: "", amount: "", note: "" });
  const [out, setOut] = useState(null);
  const [err, setErr] = useState("");

  const key = user ? "bexley_payout_" + user.id : null;
  const email = user?.email?.address || user?.google?.email || "Signed in";

  // Remember the merchant's account in this browser (a database comes later)
  useEffect(() => {
    if (!key) { setSaved(""); setAcct(""); return; }
    try {
      const v = localStorage.getItem(key);
      if (v && NAME.test(v)) { setSaved(v); setAcct(v); }
    } catch (e) {}
  }, [key]);

  async function verify() {
    setAcctErr("");
    const id = acct.trim().toLowerCase();
    if (id.length > 64 || !NAME.test(id)) return setAcctErr(NAME_HELP);
    setChecking(true);
    try {
      const r = await fetch("/api/account?id=" + encodeURIComponent(id));
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) setAcctErr(d.error || "Could not check this account.");
      else {
        setSaved(id); setAcct(id);
        try { localStorage.setItem(key, id); } catch (e) {}
      }
    } catch (e) { setAcctErr("Could not check right now. Try again."); }
    setChecking(false);
  }
  function change() {
    setSaved(""); setOut(null);
    try { localStorage.removeItem(key); } catch (e) {}
  }

  async function make() {
    setErr("");
    if (!saved) return setErr("Add your NEAR account first.");
    if (!(Number(f.amount) > 0)) return setErr("Enter an amount.");
    const u = new URL(location.origin + "/");
    u.searchParams.set("amount", f.amount); u.searchParams.set("to", saved);
    if (f.note) u.searchParams.set("note", f.note);
    if (f.shop) u.searchParams.set("shop", f.shop);
    setOut({ link: u.href, qr: await QRCode.toDataURL(u.href, { width: 440, margin: 1 }) });
  }
  const set = k => e => setF({ ...f, [k]: e.target.value });

  return (
    <div className="wrap">
      <div className="top"><div className="logo">B</div>Bexley Pay<span className="sp" />
        {authenticated && <button className="ghost link" onClick={logout}>Sign out</button>}</div>
      {!ready ? <p className="mute">Loading…</p> : !authenticated ? (
        <div className="card"><h2>Accept crypto from any chain</h2>
          <p className="mute">Sign in with email or Google. Add your .near account, and customers pay you in USDC from any chain.</p>
          <button onClick={login}>Sign in</button></div>
      ) : (<>
        <div className="card"><p className="mute">{email}</p>
          <label>Your NEAR account (where you get paid)</label>
          {saved ? (<>
            <div className="addr">{saved}</div>
            <p className="ok" style={{ margin: "10px 0 0" }}>Account found. Payments go here as USDC.</p>
            <button className="ghost" onClick={change}>Change account</button>
          </>) : (<>
            <input value={acct} onChange={e => setAcct(e.target.value)} placeholder="yourname.near" autoCapitalize="none" autoCorrect="off" spellCheck="false" />
            <button onClick={verify} disabled={checking}>{checking ? "Checking…" : "Save account"}</button>
            {acctErr && <div className="err">{acctErr}</div>}
          </>)}
        </div>
        {saved && <div className="card"><h2>New payment</h2>
          <label>Shop name</label><input value={f.shop} onChange={set("shop")} placeholder="Bexley Gadgets" />
          <label>Amount in USD</label><input type="number" min="1" step="0.01" value={f.amount} onChange={set("amount")} placeholder="40" />
          <label>What is it for?</label><input value={f.note} onChange={set("note")} placeholder="Phone case" />
          <button onClick={make}>Create payment QR</button>
          {err && <div className="err">{err}</div>}
        </div>}
        {out && <div className="card" style={{ textAlign: "center" }}>
          <p className="mute" style={{ marginBottom: 12 }}>Customer scans this with their phone camera</p>
          <div className="qr"><img src={out.qr} alt="Payment QR" /></div>
          <div className="addr" style={{ textAlign: "left" }}>{out.link}</div>
          <button className="ghost" onClick={() => navigator.clipboard.writeText(out.link)}>Copy link</button></div>}
      </>)}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <PrivyProvider appId={APP_ID} config={{ loginMethods: ["email", "google"], appearance: { theme: "dark", accentColor: "#2bd96b" } }}>
    <Dashboard />
  </PrivyProvider>
);
