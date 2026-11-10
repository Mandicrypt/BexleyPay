import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import QRCode from "qrcode";

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID || "cmwaflyog00o30hjsmoppvmnr";
const OK = /^(?:[a-f0-9]{64}|[a-z0-9]+(?:[-_.][a-z0-9]+)*)$/;

function Dashboard() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  const [custom, setCustom] = useState("");
  const [f, setF] = useState({ shop: "", amount: "", note: "" });
  const [out, setOut] = useState(null);
  const [err, setErr] = useState("");

  const wallet = user?.linkedAccounts?.find(a => a.type === "wallet" && a.chainType === "near");
  useEffect(() => {
    if (authenticated && user && !wallet && !creating.current) {
      creating.current = true;
      createWallet({ chainType: "near" }).catch(e => setErr("Could not create your wallet: " + e.message)).finally(() => (creating.current = false));
    }
  }, [authenticated, user, wallet]);

  const payout = custom.trim() || wallet?.address || "";
  const email = user?.email?.address || user?.google?.email || "Signed in";

  async function make() {
    setErr("");
    if (!(Number(f.amount) > 0)) return setErr("Enter an amount.");
    if (!payout || payout.length < 2 || payout.length > 64 || !OK.test(payout)) return setErr("Payout account is not a valid NEAR address.");
    const u = new URL(location.origin + "/");
    u.searchParams.set("amount", f.amount); u.searchParams.set("to", payout);
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
          <p className="mute">Sign in with email, Google or a wallet. We create a NEAR wallet for you, and customers pay you in USDC.</p>
          <button onClick={login}>Sign in</button></div>
      ) : (<>
        <div className="card"><p className="mute">{email}</p>
          <label>Your payout wallet (NEAR)</label>
          <div className="addr">{wallet?.address || "Creating your wallet…"}</div>
          <label>Or use a NEAR account you already own</label>
          <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="yourname.near" />
        </div>
        <div className="card"><h2>New payment</h2>
          <label>Shop name</label><input value={f.shop} onChange={set("shop")} placeholder="Bexley Gadgets" />
          <label>Amount in USD</label><input type="number" min="1" step="0.01" value={f.amount} onChange={set("amount")} placeholder="40" />
          <label>What is it for?</label><input value={f.note} onChange={set("note")} placeholder="Phone case" />
          <button onClick={make}>Create payment QR</button>
          {err && <div className="err">{err}</div>}
        </div>
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
  <PrivyProvider appId={APP_ID} config={{ loginMethods: ["email", "google", "wallet"], appearance: { theme: "dark", accentColor: "#2bd96b" } }}>
    <Dashboard />
  </PrivyProvider>
);
