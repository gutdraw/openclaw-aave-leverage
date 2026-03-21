# Example: 2x ETH Long

Open a 2x leveraged long on ETH using WETH as seed collateral, then close it.

---

## Step 1 — Wrap ETH (if needed)

If you have native ETH but need WETH:

```
swap(
  token_in: "ETH",
  token_out: "WETH",
  amount_in: "0.01",
  user_address: "0xYOUR_WALLET"
)
```

---

## Step 2 — Open the position

```
chat(
  message: "open a 2x ETH long with 0.01 WETH",
  user_address: "0xYOUR_WALLET"
)
```

The agent returns a plan:
```
reply: "I'll open a 2x WETH/USDC long. I'll supply 0.01 WETH as seed, flash-borrow USDC,
        swap it to 0.01 more WETH, and supply all 0.02 WETH to Aave. Health factor: ~1.90.
        Liquidation price: ~$1,200."

transaction_steps: [
  { step: 1, title: "Approve WETH", type: "approve", ... },
  { step: 2, title: "Delegate USDC debt", type: "approveDelegation", ... },
  {
    step: 3,
    title: "Open 2x ETH long",
    type: "openPosition",
    contract: "0x7a7956cb5954588188601A612c820df64ecd23D6",
    gas: 1000000,
    provenance: {
      "fn": "quoteExactInputSingle",
      "token_in": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "token_out": "0x4200000000000000000000000000000000000006",
      ...
    }
  }
]
```

**Verify the quote before signing step 3:**

```bash
node verify/verify-quote.js \
  --provenance '<paste provenance from step 3>' \
  --rpc 'https://mainnet.base.org'
```

Sign all 3 steps in order.

---

## Step 3 — Check position

```
get_position(user_address: "0xYOUR_WALLET")
```

Expected:
```
Health factor: 1.90
Total collateral: ~$63.00 (0.02 WETH)
Total debt:       ~$33.00 USDC
Leverage:         ~2x
Liquidation price: ~$1,200/ETH
```

---

## Step 4 — Partial close (optional)

```
chat(
  message: "close 50% of my ETH long",
  user_address: "0xYOUR_WALLET"
)
```

This reduces leverage in-place without fully closing the position.

---

## Step 5 — Full close

```
chat(
  message: "close my ETH position",
  user_address: "0xYOUR_WALLET"
)
```

Or structured:
```
prepare_close(
  user_address: "0xYOUR_WALLET",
  position_id: "WETH/USDC"
)
```

---

## Leverage adjustment (no close/reopen)

To reduce leverage from 2x to 1.5x without closing:
```
prepare_reduce(
  user_address: "0xYOUR_WALLET",
  supply_asset: "WETH",
  borrow_asset: "USDC",
  target_leverage: 1.5
)
```

To increase leverage:
```
prepare_increase(
  user_address: "0xYOUR_WALLET",
  supply_asset: "WETH",
  borrow_asset: "USDC",
  target_leverage: 3.0
)
```

---

## Notes

- Max leverage: 4.5x for WETH/USDC
- ETH long profits when ETH price rises vs USD
- wstETH/WETH long is also available (earns staking yield while levered)
- Close slippage is floored at 1% — the server always quotes conservatively on close
