# Example: 3x BTC Long

Open a 3x leveraged long on Bitcoin using cbBTC as seed collateral, then close it.

---

## Step 1 — Check your wallet

```
get_position(user_address: "0xYOUR_WALLET")
```

Expected output:
```
Health factor: — (no position)
cbBTC balance: 0.001 cbBTC (~$97.00)
USDC balance:  5.00 USDC
```

---

## Step 2 — Open the position

```
chat(
  message: "open a 3x BTC long using 0.001 cbBTC as seed",
  user_address: "0xYOUR_WALLET"
)
```

The agent returns a plan:
```
reply: "I'll open a 3x cbBTC/USDC long. I'll supply 0.001 cbBTC as seed, flash-borrow
        USDC, swap it to 0.002 cbBTC, and supply all 0.003 cbBTC to Aave. You'll borrow
        USDC against it. Health factor: ~1.55. Liquidation price: ~$78,000."

transaction_steps: [
  {
    "step": 1,
    "title": "Approve cbBTC",
    "type": "approve",
    "contract": "0xcbB7C0000Ab88B473b1f5aFd9ef808440eed33Bf",
    "abi_fn": "approve(address,uint256)",
    "args": ["0x7a7956cb5954588188601A612c820df64ecd23D6", "100000"]
  },
  {
    "step": 2,
    "title": "Delegate USDC debt",
    "type": "approveDelegation",
    "contract": "0x59dca05b6c26dbd64b5381374aAaC5CD05644C28",
    "abi_fn": "approveDelegation(address,uint256)",
    "args": ["0x7a7956cb5954588188601A612c820df64ecd23D6", "115792..."]
  },
  {
    "step": 3,
    "title": "Open 3x BTC long",
    "type": "openPosition",
    "contract": "0x7a7956cb5954588188601A612c820df64ecd23D6",
    "abi_fn": "openPosition(...)",
    "gas": 1000000,
    "provenance": {
      "fn": "quoteExactInputSingle",
      "token_in": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "token_out": "0xcbB7C0000Ab88B473b1f5aFd9ef808440eed33Bf",
      "amount_in": 6494200,
      "fee": 500,
      "raw_quote": 62160,
      "slippage_bps": 50,
      "min_out": 61847
    }
  }
]
```

**Before signing step 3, verify the quote:**

```bash
node verify/verify-quote.js \
  --provenance '{"fn":"quoteExactInputSingle","token_in":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","token_out":"0xcbB7C0000Ab88B473b1f5aFd9ef808440eed33Bf","amount_in":6494200,"fee":500,"raw_quote":62160,"slippage_bps":50,"min_out":61847}' \
  --rpc 'https://mainnet.base.org'
```

Expected output:
```
Verifying quote via https://mainnet.base.org
Function  : quoteExactInputSingle
Token in  : 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Token out : 0xcbB7C0000Ab88B473b1f5aFd9ef808440eed33Bf
Amount in : 6494200
Server raw_quote : 62160
Your independent quote : 62183
Difference : 37 bps (tolerance: 100 bps)

RESULT: PASS ✓ — quote verified, safe to sign
```

Sign and submit all 3 steps in order.

---

## Step 3 — Check position after open

```
get_position(user_address: "0xYOUR_WALLET")
```

Expected:
```
Health factor: 1.55
Total collateral: ~$291 (0.003 cbBTC)
Total debt:       ~$194 USDC
Leverage:         ~3x
Liquidation price: ~$78,000/BTC
```

---

## Step 4 — Close the position

```
chat(
  message: "close my BTC position",
  user_address: "0xYOUR_WALLET"
)
```

The agent returns close steps. Verify the provenance quote for the close step, then sign all steps.

---

## Notes

- Minimum seed: ~$1 worth of cbBTC
- Max leverage: 3.3x for cbBTC/USDC (Aave LTV cap)
- Health factor below 1.1 will be rejected by the server
- If BTC pumps, your health factor rises — position becomes safer
- If BTC dumps below liquidation price, Aave liquidators will close it for you (with penalty)
