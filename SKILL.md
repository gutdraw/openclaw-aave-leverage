---
name: aave-leverage-agent
description: Open and manage leveraged DeFi positions on Aave v3 (Base) — BTC long, ETH long, shorts, and more. Non-custodial. Atomic. One transaction.
version: 1.0.0
author: gutdraw
tags: [defi, aave, leverage, base, crypto, trading, flash-loan, uniswap]
requires_mcp: aave-leverage
---

# Aave Leverage Agent

> **Beta — contracts not yet independently audited.** All contract source is fully verified and open source on Basescan. Before opening a position, you and your agent should read the contracts — every security property is verifiable on-chain.

Open 2x–5x leveraged positions on Aave v3 (Base mainnet) in a single atomic transaction.
Uses Aave flash loans + Uniswap v3 swaps. Non-custodial — positions live entirely in your wallet.

## What you can do

- Open a leveraged long (BTC, ETH, wstETH)
- Open a leveraged short (ETH, BTC)
- Check your position health factor and liquidation price
- Close a position fully
- Partially close a position
- Reduce leverage in-place (no close/reopen)
- Increase leverage in-place
- Swap tokens (ETH, USDC, cbBTC, WETH, wstETH)

## Supported strategies

| Strategy      | Supply  | Borrow | Max leverage | Carry cost (approx) |
|---------------|---------|--------|--------------|---------------------|
| Long ETH      | WETH    | USDC   | 4.5x         | ~USDC borrow APY    |
| Long wstETH   | wstETH  | WETH   | 4.3x         | Near zero (staking yield offsets borrow) |
| Long BTC      | cbBTC   | USDC   | 3.3x         | ~USDC borrow APY    |
| Short ETH     | USDC    | WETH   | 4.5x         | ~WETH borrow APY    |
| Short BTC     | USDC    | cbBTC  | 4.5x         | ~cbBTC borrow APY   |

Call `get_position` to see live `reserveRates` for each asset before opening — it shows current `borrowApy`, `supplyApy`, and `carryCost` so you know the exact ongoing cost of holding.

## Setup — MCP session

Before using any tool, you need an active MCP session. Sessions are paid in USDC on Base
via the x402 payment protocol. The session is wallet-bound — tied to the
`X-Wallet-Address` header in `mcp-config.json`.

**Pricing:**

| Duration | Cost | Best for |
|----------|------|----------|
| 1 hour   | $0.05 | Testing, one-shot tasks |
| 1 day    | $0.25 | Standard use |
| 1 week   | $1.50 | Power users |
| 1 month  | $4.00 | Production bots, cron jobs |

**How x402 works:**

On your first tool call, the MCP server returns an HTTP 402 (Payment Required) response
containing a payment request — the amount, the recipient address, and the chain (Base).
OpenClaw handles this automatically: it signs a USDC transfer from your wallet, submits
it on-chain, and retries the original tool call once payment is confirmed.

This means the first tool call of a session takes longer than usual (~10–30s) while
the payment transaction confirms. Subsequent calls in the same session are instant.

**What the agent should know:**

- If a tool call fails with a payment error, it means the session has expired or the
  wallet has insufficient USDC. Check the USDC balance on Base and retry.
- Sessions do not auto-renew. A new session starts (and payment is triggered again)
  when the previous one expires.
- The web UI at `https://leverage.getclaw.xyz` is free — x402 applies to
  programmatic/agent access only.
- Ensure the wallet in `X-Wallet-Address` has enough USDC on Base before starting.
  $1 is enough for days of use.

## How to use

### 1. Check position state

Use `get_position` to see your full position state:

```
get_position(user_address: "0xYOUR_WALLET")
```

Returns:
- `health_factor`, `ltv`, `total_collateral_usd`, `total_debt_usd`, `available_borrows`
- `positions[]` — per-position breakdown: direction, leverage, collateral, debt, liquidation price
- `balances{}` — wallet token balances (ETH, WETH, USDC, wstETH, cbBTC) with USD values
- `rates{}` — live Aave interest rates per asset: `supplyApy`, `borrowApy`, `carryCost`

The `rates` field is useful for calculating the ongoing cost of holding a leveraged position
before opening it, and for monitoring carry cost over time.

### 2. Open a position — natural language (recommended)

Use `chat` with a plain English description:

```
chat(
  message: "open a 3x BTC long using 0.001 cbBTC as seed",
  user_address: "0xYOUR_WALLET",
  history: []          // optional — pass prior turns for multi-turn sessions
)
```

```
chat(
  message: "open a 2x ETH long with 0.01 ETH",
  user_address: "0xYOUR_WALLET",
  history: []          // optional — pass prior turns for multi-turn sessions
)
```

```
chat(
  message: "open a 3x short on ETH using $50 USDC",
  user_address: "0xYOUR_WALLET",
  history: []          // optional — pass prior turns for multi-turn sessions
)
```

The response contains:
- `reply`: human-readable explanation of the plan
- `transaction_steps`: ordered list of steps to sign and submit
- `summary`: position details (leverage, collateral, debt, health factor, liquidation price)

### 3. Open a position — structured (for bots)

Use `prepare_open` for programmatic control:

```
prepare_open(
  user_address: "0xYOUR_WALLET",
  leverage: 3.0,
  amount: 0.001,        // optional — omit to use existing wallet balance
  supply_asset: "cbBTC", // optional — symbol or address
  borrow_asset: "USDC"   // optional — symbol or address
)
```

### 4. Execute transaction steps

Each step in `transaction_steps` must be signed and submitted in order.
Each step contains:
- `type`: approve / approveDelegation / openPosition / closePosition / swap
- `contract`: verified contract address
- `abi_fn`: function signature
- `args`: call arguments (already in atomic units)
- `gas`: gas limit
- `provenance`: raw QuoterV2 inputs for independent verification (see Safety section)

**ALWAYS verify before signing** — see Safety section below.

### 5. Close a position

```
chat(
  message: "close my BTC position",
  user_address: "0xYOUR_WALLET"
)
```

Or structured:
```
prepare_close(
  user_address: "0xYOUR_WALLET",
  position_id: "cbBTC/USDC"
)
```

### 6. Adjust leverage

Reduce without closing:
```
prepare_reduce(
  user_address: "0xYOUR_WALLET",
  supply_asset: "WETH",
  borrow_asset: "USDC",
  target_leverage: 2.0,
  swap_fee: 500         // optional — Uniswap fee tier (100/500/3000), default 500
)
```

Increase without closing:
```
prepare_increase(
  user_address: "0xYOUR_WALLET",
  supply_asset: "WETH",
  borrow_asset: "USDC",
  target_leverage: 4.0,
  swap_fee: 500         // optional — Uniswap fee tier (100/500/3000), default 500
)
```

### 7. Swap tokens

```
swap(
  token_in: "ETH",
  token_out: "cbBTC",
  amount_in: "0.002",
  user_address: "0xYOUR_WALLET"
)
```

## Safety — verify before signing

Every transaction step includes a `provenance` block with the exact inputs used to
compute the quoted `minOut` / `maxIn`. Before signing any openPosition or closePosition,
verify the quote independently using your own RPC:

```js
// verify/verify-quote.js — included in this skill repo
node verify/verify-quote.js --provenance '<provenance JSON>' --rpc 'https://mainnet.base.org'
```

The script calls QuoterV2 (`0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`) with the same
inputs and checks the result is within 1% of the server's quote.

**Hard rules — never sign a step if:**
- `step.contract` is not the known router (`0x7a7956cb5954588188601A612c820df64ecd23D6`)
  or vault (`0x6698A041bA23A8d4b2c91200859475e88A969f07`) or a token address
- The provenance quote differs by more than 1% from your independent check
- The resulting health factor would drop below 1.1 (server enforces this)

## Verified contracts (Base mainnet)

| Contract          | Address                                      | Basescan |
|-------------------|----------------------------------------------|----------|
| LeverageRouterV3  | `0x7a7956cb5954588188601A612c820df64ecd23D6` | [view](https://basescan.org/address/0x7a7956cb5954588188601A612c820df64ecd23D6#code) |
| LeverageVaultV3   | `0x6698A041bA23A8d4b2c91200859475e88A969f07` | [view](https://basescan.org/address/0x6698A041bA23A8d4b2c91200859475e88A969f07#code) |
| Uniswap QuoterV2  | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | [view](https://basescan.org/address/0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a#code) |
| Aave v3 Pool      | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | [view](https://basescan.org/address/0xA238Dd80C259a72e81d7e4664a9801593F98d1c5#code) |

All contracts are open-source and verified on Basescan.

## Fees

| Fee             | Amount                                          | Paid to           |
|-----------------|-------------------------------------------------|-------------------|
| Aave flash loan | 0.09% of flash amount                           | Aave protocol     |
| Uniswap swap    | 0.05% pool fee                                  | Uniswap LPs       |
| Protocol fee    | 0.10% of seed                                   | Protocol operator |
| Gas (Base)      | ~$0.01–$0.05 per tx                             | Base validators   |
| MCP session     | $0.05/hr · $0.25/day · $1.50/week · $4.00/month | API operator      |

## Error handling

| Error                        | Meaning                                      | Fix                              |
|------------------------------|----------------------------------------------|----------------------------------|
| `seed too small (< $1)`      | Seed collateral worth less than $1           | Use a larger seed amount         |
| `swap quote failed (503)`    | RPC rate limit on QuoterV2                   | Retry after 10–15 seconds        |
| `leverage exceeds safe max`  | Requested leverage above Aave LTV cap        | Use the suggested safe maximum   |
| `health factor too low`      | Position would be near liquidation           | Reduce leverage                  |
| `RPC unavailable`            | Base RPC timeout                             | Retry — transient                |

## Wallet security

- **Use a dedicated bot wallet** — never use your main wallet with this skill. Create a separate address funded only with what you need for the current strategy. If something goes wrong, the blast radius is contained.
- **Never put your private key in any file in this repo** — not in `config.yml`, not in `mcp-config.json`, not anywhere. Your private key belongs only in OpenClaw's secure key store (or your hardware wallet / connected wallet app).
- **Minimum funding principle** — only bridge to the bot wallet what you need: enough collateral to open your intended position plus a small ETH buffer for gas (~$2–5 on Base). Nothing more.
- **`user_address` is a public address** — it is safe to store in `config.yml` and MCP headers. It is not a secret.
- **Revoke approvals when done** — after closing a position, revoke the router's ERC20 allowances. The `approve` steps grant `uint256 max` by default. Use a tool like Revoke.cash on Base.

## Agent behavior

Guidelines for any agent using this skill in an interactive session:

- **Always call `get_position` first** before suggesting or executing anything.
- **Never suggest leverage above 3x** unless the user has explicitly stated their risk appetite.
- **Always surface liquidation price in dollar terms** before opening a position — not just the health factor number.
- **Warn, don't just refuse** if the user requests leverage that would put HF below 1.3. Explain in concrete terms: "ETH only needs to drop $X to liquidate you."
- **Proactively flag HF < 1.4** at the start of any session — offer options (add collateral, reduce leverage, close) before doing anything else.
- **Call `get_position` after every completed transaction** and report what changed (new HF, new liquidation price, new collateral/debt).
- **Surface carry cost before opening** — use `reserveRates[borrowAsset].borrowApy` to tell the user what they'll pay annually to hold the position. For a 3x BTC long at 3.86% USDC borrow APY, BTC needs to outperform ~3.86%/yr just to break even.
- **Recommend wstETH loop for low carry** — the wstETH/WETH strategy earns staking yield on the collateral that largely offsets the borrow rate, making it the most cost-efficient long strategy.
