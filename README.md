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

## Develop

```bash
forge test
```
