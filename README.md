# Mecenate

Minimal griefing escrow for selling data, in the style of Mecenate v2 / Erasure: one contract, any plain ERC20, no owner, no fees.

## Flow

1. **create** — seller stakes behind a post: `stake`, asked `payment`, `ratio` (bps the buyer pays to burn), `period`, and a `proofhash` committing to data, key and ciphertext.
2. **accept** — buyer pays and leaves a public key. Or via the Bay: buyer escrows a reward with **request**, a seller answers with **fill** using a post that meets its terms (token, min stake, max ratio, min period).
3. **submit** — seller posts the symmetric key encrypted to the buyer, before `period` runs out. The payment joins the stake: from now on no refunds.
4. Within `period` after submit the buyer either **release**s (seller gets stake + payment) or **punish**es once: burns `amount` of the stake and pays `amount * ratio / 10000` of their own to the burn address; the rest goes back to the seller. After `period` anyone can release.
5. **reveal** — seller can publish the key once the sale is closed.

**cancel**: seller any time before submit (refunds both); buyer once the seller has missed the delivery window. **topUp**: seller adds stake before delivery. **cancelRequest**: buyer takes back an unfilled request.

`stats(seller)` counts finalized and punished sales, for reputation. Burned funds go to `0x…dEaD`.

## Not included (vs Mecenate v2)

ETH (wrap to WETH), MUSE token, Uniswap buy-and-burn, treasury fees, Sismo identity, EAS attestations (`stats` replaces them), user key registry (the buyer key travels with `accept`/`request`), proxies and factories.

## Limits

- Not audited.
- Fee-on-transfer and rebasing tokens break the accounting.
- `stats` can be farmed by a seller buying from themselves.
- The app supports the tokens listed in `ui/src/config.ts`; posts in other tokens show without actions.

## App

`ui/` is the web app, built to be published on [Freenet](https://freenet.org) like FreeSwap: the page runs in Freenet's sandbox, and the wallet is reached through `bridge.html`, a popup served from GitHub Pages that relays only Mecenate's requests (`ui/src/guard.ts`).

- **Keys.** The wallet signs one fixed message per session; the app derives from it an X25519 key (buyers receive keys on it) and a seed for encrypting files. Nothing is stored: the sandbox has no storage. Whoever gets that signature can decrypt what you bought, so the bridge signs only that message and asks for a click first.
- **Selling.** The file is encrypted in the browser (AES-256-GCM) and you download the ciphertext; publish it anywhere and put where in the post. The proofhash commits to the data, the key and the ciphertext. To deliver, the seller picks the ciphertext again: the app re-derives its key, checks it against the proofhash and seals it to the buyer.
- **Buying.** After delivery the buyer picks the ciphertext, the app opens the sealed key, decrypts, checks everything against the proofhash and downloads the data. Reveal publishes the key on-chain, checked against the proofhash.
- Reads go through `eth_call` only (no log queries), so the contract keeps what the app shows in storage. The Market shows the latest 30 posts, the Bay the latest 50 requests.

To go live: deploy (`forge script script/Deploy.s.sol --rpc-url <rpc> --account <keystore> --broadcast`), put the address in `ui/src/config.ts`, enable Pages (Settings → Pages → Source: GitHub Actions), then `cd ui && npm run build && fdev website publish dist --key mecenate`.

## Develop

```bash
forge test
forge build && cd ui && npm install && npm test   # crypto round trip, guard rules, ABI vs contract
npm run dev                                       # http://localhost:5173 (not sandboxed; wallet needed)
```
