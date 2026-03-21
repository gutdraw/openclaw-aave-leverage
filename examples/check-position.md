# Example: Check Position Health

Monitor your Aave position — health factor, liquidation price, and token balances.

---

## Check current state

```
get_position(user_address: "0xYOUR_WALLET")
```

---

## Example output (active 3x BTC long)

```json
{
  "health_factor": 1.55,
  "ltv": 0.67,
  "total_collateral_usd": 291.00,
  "total_debt_usd": 194.00,
  "net_value_usd": 97.00,
  "liquidation_threshold": 0.78,
  "positions": [
    {
      "supply_asset": "cbBTC",
      "supply_amount": "0.003000",
      "supply_usd": 291.00,
      "borrow_asset": "USDC",
      "borrow_amount": "194.00",
      "borrow_usd": 194.00,
      "leverage": 3.0,
      "liquidation_price_usd": 78000
    }
  ],
  "wallet_balances": {
    "ETH":   "0.012",
    "WETH":  "0.000",
    "cbBTC": "0.000",
    "USDC":  "5.00",
    "wstETH":"0.000"
  }
}
```

---

## Understanding the numbers

| Field | What it means |
|-------|---------------|
| `health_factor` | Must stay above 1.0. Below 1.0 = liquidatable. Keep above 1.2 for safety. |
| `ltv` | Current loan-to-value ratio. Rises if collateral price drops. |
| `liquidation_price_usd` | BTC/ETH price at which your position gets liquidated. |
| `net_value_usd` | Your equity = collateral − debt. This is what you'd get back on close. |

---

## Health factor guide

| Health Factor | Status |
|---------------|--------|
| > 2.0 | Very safe |
| 1.5–2.0 | Safe (typical target for 3x) |
| 1.2–1.5 | Caution — consider reducing leverage |
| 1.0–1.2 | Danger zone — act quickly |
| < 1.0 | Liquidatable |

---

## Monitoring as a bot

You can poll this endpoint on a schedule to alert when health factor drops:

```
# Every 10 minutes, check health factor
get_position(user_address: "0xYOUR_WALLET")
# If health_factor < 1.3 → reduce leverage or close
prepare_reduce(user_address: "0xYOUR_WALLET", supply_asset: "cbBTC", borrow_asset: "USDC", target_leverage: 2.0)
```

---

## No position

If you have no active position:

```json
{
  "health_factor": null,
  "total_collateral_usd": 0,
  "total_debt_usd": 0,
  "positions": [],
  "wallet_balances": {
    "ETH":   "0.050",
    "cbBTC": "0.001",
    "USDC":  "25.00"
  }
}
```
