# Bexley Pay

**Accept crypto from any chain. Get paid in USDC on NEAR.**

Live app: https://bexley-pay.vercel.app  
Merchant dashboard: https://bexley-pay.vercel.app/merchant/

Built for NEAR HACKATHON 2026. Track: **Real-World Money** (merchant payments and stablecoin rails).

## How NEAR is used

- **NEAR Intents, 1Click Swap API** (`/tokens`, `/quote`, `/status`): moves the customer's payment from any supported chain into USDC on NEAR, with refunds on the origin chain.
- **USDC on NEAR** is what the merchant receives, straight into their own named account.
- **Named `.near` accounts** are the merchant's payout account. The server checks each one against NEAR RPC before saving it.

## The problem

A shop that accepts crypto usually accepts one chain. A customer holding SOL, ETH, BTC or a token on another chain has to swap, bridge or go through an exchange first, then send. Most customers give up.

## What Bexley Pay does

The merchant makes a payment link or QR code for the shop counter. The customer scans it, picks the chain and token they already hold, and sends from any wallet or exchange app. NEAR Intents handles the swap and the cross-chain move. The merchant receives **USDC on their own `.near` account**.

No bridge for the customer. No exchange step. No wallet for the merchant to create or manage.

## Try it (for judges)

You do not need to pay to see the flow. A real payment needs real money (there is no NEAR Intents testnet), so the last step is optional.

**Customer side, no sign-in**
1. Open https://bexley-pay.vercel.app/?amount=1&to=bexley.near&shop=Demo%20Shop&for=Judge
2. You should see "Demo Shop", "Invoice for Judge" and $1.00.
3. Pick a chain and a token. Enter a refund address on that chain.
4. Click "Get payment details". You should see a deposit address, the amount to send, and a countdown.
5. Optional: send that amount from any wallet. The page changes to Paid and shows a receipt link.

**Merchant side, no sign-in**
1. Open https://bexley-pay.vercel.app/
2. Enter a `.near` account, a shop name and an amount, then click "Create payment QR". A made-up account should show "not found on NEAR".
3. You should see a QR code and a link. Open the link to see the customer page.

**Merchant dashboard, with sign-in (saves your account and shows history)**
1. Click "Sign in to your dashboard", or open https://bexley-pay.vercel.app/merchant/ and sign in with email or Google.
2. Save your shop name and `.near` account once.
3. On the New payment tab, create a payment. On the History tab, see each payment with its status. Paid ones have a Receipt link.

## How it works

1. The merchant signs in (email or Google), saves their `.near` account once, and creates a payment: amount, what it is for, and who the invoice is for.
2. The app gives a link and a QR code.
3. The customer opens it, picks the chain and token, and enters a refund address on that chain.
4. The server asks the 1Click API for an exact-output quote, so the merchant gets exactly the amount asked, and shows a deposit address.
5. The customer sends from any app. The page shows live status: waiting, confirming, sending, paid.
6. On success the customer gets a receipt page, and the payment shows in the merchant's History.

## Features

- Pay from any chain and token that NEAR Intents supports
- QR code for shop counters, plus shareable links
- No-sign-in QR maker on the front page, for any merchant with a `.near` account
- Optional merchant sign-in with email or Google (Privy), to save the account and see history
- Merchants enter their own `.near` account. The server checks that the account exists before saving it
- Payment history with status for each payment
- Customer name on each invoice
- Shareable receipt page for each paid order (print or save as PDF)
- Refunds on the origin chain if a payment fails
- Optional app fee (basis points) through the 1Click API

## Stack

- Node.js and Express (API and static pages)
- NEAR Intents 1Click Swap API: `/tokens`, `/quote`, `/status`
- NEAR RPC, to verify merchant accounts
- Vite and React for the merchant dashboard, Privy for sign-in
- Neon Postgres for merchant accounts and payment history
- Hosted on Vercel

## Built during the hackathon

All code in this repository was written between the start of the hackathon window and the deadline, with AI coding assistance (Claude). The 1Click API key comes from the NEAR Intents partner portal. No other code is reused.

Libraries: Express, Vite, React, `@privy-io/react-auth`, `qrcode`, `@neondatabase/serverless`, `jose`, `near-api-js`, `dotenv`.

## Other project by the same team

Bexley (https://bexley-sigma.vercel.app) is a separate entry: a leveraged-token protocol on NEAR, with its own repository and submission. Bexley Pay is independent of it.

## Run it yourself

1. Install Node.js (the LTS version).
2. Copy `.env.example` to `.env` and fill it in.
3. Run `npm install --legacy-peer-deps`, then `npm run build`, then `npm start`.
4. Open http://localhost:3000

### Settings

| Name | What it is |
| --- | --- |
| `ONECLICK_JWT` | Your 1Click API key |
| `MERCHANT_NEAR_ACCOUNT` | Fallback `.near` account when a link has no valid one |
| `DATABASE_URL` | Neon Postgres connection string (needed for sign-in accounts and history) |
| `FEE_BPS`, `FEE_RECIPIENT` | Optional app fee and where it is paid |

## Safety notes

- There is no NEAR testnet for 1Click, so tests use small real payments.
- The merchant account in a link must be a valid `.near` name. Anything else falls back to the default account.
- Merchant endpoints check the sign-in token on the server. A merchant can only see their own payments.
- History is optional for the payment itself. If the database is down, customers can still pay.

## Status and next steps

Working today: end-to-end payments (tested with a real SOL to USDC payment that arrived on NEAR), QR flow, merchant sign-in, saved accounts, history, receipts.

Next:
- NFT receipts on NEAR. The minting code is in the repo but switched off, until we have an NFT store contract
- Apple sign-in
- Email receipts and CSV export for bookkeeping
- Settlement to other assets

## License

MIT. See [LICENSE](LICENSE).
