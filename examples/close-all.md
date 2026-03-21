# Example: Close All Positions

Atomically close every open Aave position in a single transaction batch.

---

## When to use this

- You want to exit all leveraged exposure at once
- Emergency exit (health factor dropping, market moving against you)
- Rebalancing before a new strategy

---

## Close all positions

```
chat(
  message: "close all my positions",
  user_address: "0xYOUR_WALLET"
)
```

Or structured:
```
prepare_close(
  user_address: "0xYOUR_WALLET",
  position_id: "all"
)
```

---

## What the agent returns

If you have both a BTC long and an ETH long, you'll get steps like:

```
reply: "I'll close your WETH/USDC and cbBTC/USDC positions. Two flash loan transactions
        will repay all debt and return collateral to your wallet."

transaction_steps: [
  { step: 1, title: "Close WETH/USDC position", type: "closePosition", ... },
  { step: 2, title: "Close cbBTC/USDC position", type: "closePosition", ... }
]
```

Each `closePosition` step carries its own `provenance` block. Verify each one:

```bash
# Verify close step 1
node verify/verify-quote.js \
  --provenance '<provenance from step 1>' \
  --rpc 'https://mainnet.base.org'

# Verify close step 2
node verify/verify-quote.js \
  --provenance '<provenance from step 2>' \
  --rpc 'https://mainnet.base.org'
```

---

## After closing

```
get_position(user_address: "0xYOUR_WALLET")
```

Expected:
```
Health factor: — (no active position)
Total collateral: $0.00
Total debt: $0.00

Token balances:
  WETH:  0.009... (seed returned, minus swap fees)
  cbBTC: 0.0009... (seed returned, minus swap fees)
  USDC:  any leftover from close
```

You'll get back slightly less than your original seed due to:
- Aave flash loan fee (0.09%)
- Uniswap swap fee (0.05%)
- Protocol fee (0.10%)
- Gas (~$0.01–$0.05 per close tx)

---

## Notes

- Close slippage is always at least 1% (100 bps) to account for price movement between quote and execution
- If the position is very large, the agent may split into two close transactions
- "Partial close" is also available: `"close 30% of my BTC position"`
