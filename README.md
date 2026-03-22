# aave-leverage — OpenClaw Skill

> Open 2x–5x leveraged DeFi positions on Aave v3 (Base) in a single atomic transaction.
> Flash loans + Uniswap swaps. Non-custodial. One signature.

---

## What this skill does

| Action | Example |
|--------|---------|
| Open a leveraged long | "open a 3x BTC long with 0.001 cbBTC" |
| Open a leveraged short | "short ETH 2x using $50 USDC" |
| Check health factor | "what's my position health?" |
| Close fully | "close my BTC position" |
| Partial close | "close 50% of my ETH long" |
| Adjust leverage | "reduce my ETH long to 2x" |
| Swap tokens | "swap 0.01 ETH to USDC" |

Supported strategies: Long ETH, Long wstETH, Long BTC, Short ETH, Short BTC.

---

## Quick start

### 1. Add the MCP server to OpenClaw

Copy `mcp-config.json` and add it to your `openclaw.json`.

> **Changing the server URL?** Edit only `mcp-config.json` — that is the single source of truth for the endpoint.

```json
{
  "mcpServers": {
    "aave-leverage": {
      "url": "https://aave-leverage-agent-production.up.railway.app/mcp",
      "headers": {
        "X-Wallet-Address": "0xYOUR_WALLET_ADDRESS"
      }
    }
  }
}
```

### 2. Add the skill

Copy `SKILL.md` into your OpenClaw skills directory or submit to ClawHub.

### 3. Use it

```
open a 3x BTC long using 0.001 cbBTC as seed
```

OpenClaw will call `chat()`, receive a list of signed transaction steps, and guide you through signing each one.

---

## Safety — independent quote verification

Every `openPosition` and `closePosition` step includes a `provenance` block with the exact inputs used to compute the swap quote. Before signing, verify it yourself:

```bash
node verify/verify-quote.js \
  --provenance '<paste provenance JSON from step>' \
  --rpc 'https://mainnet.base.org'
```

This calls Uniswap's QuoterV2 (`0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`) directly from your own RPC and confirms the server's quote is within 1%.

**Never sign a step if:**
- `step.contract` is not the known router or vault (see below)
- The provenance quote differs by more than 1% from your independent check
- The resulting health factor would drop below 1.1 (server enforces this)

---

## Verified contracts (Base mainnet)

| Contract | Address |
|----------|---------|
| LeverageRouterV3 | `0x7a7956cb5954588188601A612c820df64ecd23D6` |
| LeverageVaultV3 | `0x6698A041bA23A8d4b2c91200859475e88A969f07` |
| Uniswap QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |
| Aave v3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |

All contracts are open-source and verified on [Basescan](https://basescan.org).

---

## Session pricing (x402)

The MCP server uses the x402 payment protocol. Sessions are wallet-bound and paid in USDC on Base.

| Duration | Price | Best for |
|----------|-------|----------|
| 1 hour | $0.05 | Testing, one-shot tasks |
| 1 day | $0.25 | Standard use |
| 1 week | $1.50 | Power users |
| 1 month | $4.00 | Production bots, cron jobs |

Payment is automatic on first tool call. The web UI at [leverage.getclaw.xyz](https://leverage.getclaw.xyz) is free — x402 is for programmatic/agent access only.

---

## Fees

| Fee | Amount | Paid to |
|-----|--------|---------|
| Aave flash loan | 0.09% of flash amount | Aave protocol |
| Uniswap swap | 0.05% pool fee | Uniswap LPs |
| Protocol fee | 0.10% of seed | Protocol operator |
| Gas (Base) | ~$0.01–$0.05 per tx | Base validators |

---

## Examples

See the `examples/` directory:
- [`btc-long.md`](examples/btc-long.md) — Open and close a 3x BTC long
- [`eth-long.md`](examples/eth-long.md) — Open and close a 2x ETH long
- [`close-all.md`](examples/close-all.md) — Close all positions at once
- [`check-position.md`](examples/check-position.md) — Check health factor and balances

---

## Repo structure

```
openclaw-aave-leverage/
├── SKILL.md              # OpenClaw skill definition (submit to ClawHub)
├── mcp-config.json       # Drop-in MCP server config
├── README.md             # This file
├── verify/
│   └── verify-quote.js   # Independent QuoterV2 verification script
└── examples/
    ├── btc-long.md
    ├── eth-long.md
    ├── close-all.md
    └── check-position.md
```

---

## Requirements

- OpenClaw with MCP support
- Node.js (for `verify/verify-quote.js`)
- [Foundry](https://getfoundry.sh) installed (`cast` in PATH) for on-chain verification
- USDC on Base for x402 session payment
- A wallet with some ETH/cbBTC/USDC on Base mainnet

---

## License

MIT
