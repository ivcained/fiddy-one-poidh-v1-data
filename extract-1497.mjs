// poidh v1 (Arbitrum, combined bounty+NFT contract 0xdfFE...) -> per-wallet CSV
// Independent extractor: batched multicall state reads at latest block.
import { createPublicClient, http, parseAbi, formatEther, getAddress } from "viem"
import { arbitrum } from "viem/chains"
import fs from "node:fs"

const C = "0xdfFE8A4a4103f968Ffd61fd082D08c41dCf9b940"
const RPCS = ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"]
let rpcIdx = 0
const client = createPublicClient({ chain: arbitrum, transport: http(RPCS[0], { timeout: 60_000 }) })

const abiJson = [{"type":"function","name":"getBounties","stateMutability":"view","inputs":[{"name":"start","type":"uint256"},{"name":"end","type":"uint256"}],"outputs":[{"name":"","type":"tuple[]","components":[{"name":"id","type":"uint256"},{"name":"issuer","type":"address"},{"name":"name","type":"string"},{"name":"description","type":"string"},{"name":"amount","type":"uint256"},{"name":"claimer","type":"address"},{"name":"createdAt","type":"uint256"},{"name":"claimId","type":"uint256"}]}]}]
const abi = [...abiJson, ...parseAbi([
  "function getBountiesLength() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function claims(uint256) view returns (uint256 id, address issuer, uint256 bountyId, address bountyIssuer, string name, string description, uint256 createdAt, uint256 acceptedAt)",
])]

async function mc(calls, label) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await client.multicall({ contracts: calls, allowFailure: false })
      return res
    } catch (e) {
      process.stderr.write(`[${label}] retry ${attempt}: ${String(e.message).slice(0,80)}\n`)
      rpcIdx = (rpcIdx + 1) % RPCS.length
      await new Promise(r => setTimeout(r, 2000 + attempt * 3000))
    }
  }
  throw new Error(label + " failed after retries")
}

const block = await client.getBlockNumber()
const nBounties = Number(await client.readContract({ address: C, abi, functionName: "getBountiesLength" }))
const supply = Number(await client.readContract({ address: C, abi, functionName: "totalSupply" }))
console.log("block", block.toString(), "bounties", nBounties, "nft supply", supply)

// bounties in pages of 5 via direct calls (struct arrays don't multicall well at size)
const bounties = []
for (let s = 0; s < nBounties; s += 5) {
  const e = Math.min(nBounties - 1, s + 4)
  for (let a = 0; a < 5; a++) {
    try {
      const arr = await client.readContract({ address: C, abi, functionName: "getBounties", args: [BigInt(s), BigInt(e)] })
      bounties.push(...arr); break
    } catch (err) { process.stderr.write(`bounties ${s}-${e} retry ${a}\n`); await new Promise(r => setTimeout(r, 2000 + a * 2000)) }
  }
  if (bounties.length < e + 1) throw new Error("bounties page failed " + s)
  if (s % 100 === 0) process.stderr.write(`bounties ${s}/${nBounties}\n`)
}

// claims: every claim submitter interacted
const claimSubmitters = new Set()
for (let s = 0; s < supply; s += 50) {
  const idx = [...Array(Math.min(50, supply - s)).keys()].map(i => s + i)
  const calls = idx.map(i => ({ address: C, abi, functionName: "claims", args: [BigInt(i)] }))
  const res = await mc(calls, "claims")
  for (const c of res) claimSubmitters.add(getAddress(c[1]))
}

// NFT holders
const tokenIds = []
for (let s = 0; s < supply; s += 50) {
  const idx = [...Array(Math.min(50, supply - s)).keys()].map(i => s + i)
  const res = await mc(idx.map(i => ({ address: C, abi, functionName: "tokenByIndex", args: [BigInt(i)] })), "tokenByIndex")
  tokenIds.push(...res)
}
const held = {}
for (let s = 0; s < tokenIds.length; s += 50) {
  const batch = tokenIds.slice(s, s + 50)
  const res = await mc(batch.map(t => ({ address: C, abi, functionName: "ownerOf", args: [t] })), "ownerOf")
  for (const o of res) { const a = getAddress(o); held[a] = (held[a] || 0) + 1 }
}

// aggregate
const ZERO = "0x0000000000000000000000000000000000000000"
const paid = {}, earned = {}, nIssued = {}, nWon = {}
const wallets = new Set()
let completed = 0, cancelled = 0
for (const b of bounties) {
  const issuer = getAddress(b.issuer); wallets.add(issuer)
  const done = getAddress(b.claimer) !== ZERO && b.amount > 0n
  if (b.amount === 0n && getAddress(b.claimer) === ZERO) cancelled++
  if (done) {
    completed++
    paid[issuer] = (paid[issuer] || 0n) + b.amount
    nIssued[issuer] = (nIssued[issuer] || 0) + 1
    const claimer = getAddress(b.claimer); wallets.add(claimer)
    earned[claimer] = (earned[claimer] || 0n) + b.amount
    nWon[claimer] = (nWon[claimer] || 0) + 1
  }
}
for (const c of claimSubmitters) wallets.add(c)
const contractCs = getAddress(C)
const pendingInContract = held[contractCs] || 0
delete held[contractCs]
for (const h of Object.keys(held)) wallets.add(h)

const eth = (wei) => { const w = wei || 0n; const i = w / 10n**18n; const f = (w % 10n**18n).toString().padStart(18, "0").replace(/0+$/, ""); return f ? i + "." + f : i.toString() }
const rows = [...wallets].map(w => [w, eth(paid[w]), eth(earned[w]), held[w] || 0, nIssued[w] || 0, nWon[w] || 0])
rows.sort((a, b) => (BigInt(0) , 0) || 0) // placeholder, real sort below
rows.sort((a, b) => { const e = (paid[b[0]]||0n) - (paid[a[0]]||0n); if (earned[b[0]] !== earned[a[0]]) return (earned[b[0]]||0n) > (earned[a[0]]||0n) ? 1 : -1; return 0 })
// final CSV
const csv = ["wallet,eth_paid_out,eth_earned,v1_nfts_held,bounties_completed_issued,bounties_won", ...rows.map(r => r.join(","))].join("\n") + "\n"
fs.writeFileSync("/opt/fiddy-one/bounty-1497/poidh_v1_wallets.csv", csv)
const totalPaid = Object.values(paid).reduce((a, b) => a + b, 0n)
const totalEarned = Object.values(earned).reduce((a, b) => a + b, 0n)
const summary = { bounties: nBounties, completed, cancelled, nft_supply: supply, nfts_in_contract_pending: pendingInContract, wallets: rows.length, total_paid_out_eth: eth(totalPaid), total_earned_eth: eth(totalEarned), claim_submitters: claimSubmitters.size, holders: Object.keys(held).length, block: Number(block), chain: "arbitrum-one", contract: C.toLowerCase() }
fs.writeFileSync("/opt/fiddy-one/bounty-1497/summary.json", JSON.stringify(summary, null, 1))
console.log(JSON.stringify(summary))
