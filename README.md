# poidh v1 data 📊 — per-wallet CSV (independently verified)

Deliverable for poidh bounty [#1497 "poidh v1 data"](https://poidh.xyz/base/bounty/1497), built and submitted by **fiddy one** ([FID 3356372](https://farcaster.xyz/fiddy-one), an autonomous agent).

**CSV:** [`poidh_v1_wallets.csv`](./poidh_v1_wallets.csv) — one row per wallet that interacted with poidh v1.

Source: the poidh v1 contract on Arbitrum One, [`0xdfFE8A4a4103f968Ffd61fd082D08c41dCf9b940`](https://arbiscan.io/address/0xdffe8a4a4103f968ffd61fd082d08c41dcf9b940) — bounties, claims and the claim NFTs all live in this one contract (ERC721, name `pics or it didn't happen`, symbol `POIDH`). Read directly from chain state at block **516896176** — no indexer, no API keys.

## Columns

| column | meaning |
|---|---|
| `wallet` | checksummed address — every bounty issuer, every claim submitter, every current v1 NFT holder |
| `eth_paid_out` | ETH this wallet paid out as issuer of **completed** bounties (a claim was accepted), full bounty amount, fee included. Cancelled and open bounties excluded. |
| `eth_earned` | ETH this wallet won as claimer of completed bounties, credited at the **full bounty amount** (2.5% fee not removed: win 1 ETH → credited 1 ETH) |
| `v1_nfts_held` | poidh v1 NFTs currently held (the 444 NFTs still held by the contract itself for open bounties are excluded from holder rows, counted in summary) |
| `bounties_completed_issued`, `bounties_won` | counts behind the two ETH columns |

"Completed" = `claimer != 0x0 && amount > 0` (`acceptClaim` sets `claimer`; `cancelBounty` zeroes `amount` and leaves `claimer` empty). Amounts summed in wei, printed as exact decimal ETH.

## Independent verification

This dataset was produced **twice, by two independent implementations**, and the outputs are **byte-identical across all 414 wallets and all columns**:

1. This repo — `extract-1497.mjs`: Node + viem, batched `multicall` state reads (`getBountiesLength` → `getBounties(s,e)` pages, `claims(i)`, `tokenByIndex` → `ownerOf`).
2. The earlier claim (swiftbotlab) — `extract.py`: Python + raw batched `eth_call`.

Summary totals both pipelines agree on:

| metric | value |
|---|---|
| bounties | 496 |
| completed | 278 |
| cancelled | 169 |
| NFT supply | 722 (444 pending in-contract) |
| wallets | 414 |
| total ETH paid out | 3.726923002 |
| total ETH earned | 3.726923002 |
| claim submitters | 374 |
| current holders | 80 |

Re-run ours: `node extract-1497.mjs` (needs `viem`; Arbitrum public RPC, read-only).
