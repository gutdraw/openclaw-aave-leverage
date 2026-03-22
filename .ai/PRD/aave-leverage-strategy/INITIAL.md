# PRD: aave-leverage-strategy

## Problem Statement

The `aave-leverage` MCP skill gives an agent the tools to execute leveraged positions
but no ability to decide *when* to act. An autonomous trading agent needs a framework
for researching market conditions, generating entry/exit signals from real data, sizing
positions relative to signal strength, and tracking performance over time. Without this,
the bot has no edge and no way to measure whether it's working.

## User Stories

- As a bot operator, I want the agent to research current market conditions using
  available data sources before opening any position, so entries are based on evidence
  not guesswork.
- As a bot operator, I want position size scaled to signal confidence, so the agent
  bets more when the signal is strong and less when it's weak.
- As a bot operator, I want to run the strategy in paper trading mode before risking
  real funds, so I can validate the signal logic is working as expected.
- As a bot operator, I want a persistent trade log that tracks every entry, exit, and
  P&L over time, so I can measure whether the strategy is profitable.
- As a bot operator, I want the agent to know when conditions are unfavorable and stay
  flat rather than force a trade.

## Functional Requirements

### Market Research (runs every cycle before any decision)

Pull and interpret the following data before deciding:

- **Price trend**: 1h, 4h, 24h price change for the target asset via CoinGecko free API.
- **Borrow cost**: Current USDC and WETH borrow APR on Aave v3 Base. High rates
  reduce the edge needed to profit and are a no-trade filter.
- **Macro filter**: BTC dominance trend (24h). If BTC dominance is rising sharply,
  suppress altcoin longs.
- **Volatility check**: If the 1h candle is > 5% in either direction, skip the cycle —
  entering a leveraged position into a spike is high-risk.

### Signal Model (simple, interpretable, built-in)

Compute a **trend score** from the price data:

| Timeframes aligned | Score | Action |
|-------------------|-------|--------|
| All 3 positive | Strong long | Open long at full size |
| 2/3 positive | Moderate long | Open long at half size |
| Mixed | Neutral | No trade |
| 2/3 negative | Moderate short | Open short at half size |
| All 3 negative | Strong short | Open short at full size |

Additional filters applied on top of trend score:
- Borrow APR > 8%: suppress new entries (carry cost too high)
- BTC dominance rising > 2% in 24h: suppress altcoin longs
- 1h volatility > 5%: skip cycle entirely
- Existing position already open in same direction: hold, don't add

### Position Sizing

- Base size = configurable % of wallet collateral balance (default: 20%)
- Strong signal → full base size
- Moderate signal → 50% of base size
- Never exceed configured max leverage (default: 3x)
- Always verify resulting HF > 1.3 before committing

### Exit Rules

- **Take profit**: close when underlying asset is up configured % from entry (default: +5%)
- **Stop loss**: close when underlying is down configured % from entry (default: -3%)
- **Signal reversal**: close when trend score flips to opposite direction
- **HF defense**: reduce leverage when HF < 1.35, force close when HF < 1.2
  (risk management always overrides strategy)

### Paper Trading Mode

When `paper_trading: true`:
- All market research and signal computation runs normally
- No `prepare_*` or execution tools are called
- Trades are recorded to the trade log as if they executed at current market price
- P&L is computed using subsequent price data on each cycle
- Produces identical log output to live mode — only the execution step is skipped

Paper trading mode is the default until the operator explicitly sets `paper_trading: false`.

### Trade Log (persistent, append-only)

Every trade and every cycle must be written to a persistent log file (`trades.jsonl`).
Each entry is a JSON object on its own line. Two entry types:

**Cycle entry** (written every run regardless of action):
```json
{
  "type": "cycle",
  "ts": "2026-03-22T14:00:00Z",
  "paper": true,
  "asset": "WETH",
  "prices": {"1h": 0.8, "4h": 1.2, "24h": 2.1},
  "trend_score": "strong_long",
  "borrow_apr": 4.2,
  "btc_dominance_24h_change": 0.3,
  "volatility_1h": 1.1,
  "filters_triggered": [],
  "decision": "open_long",
  "reason": "all 3 timeframes positive, borrow APR below threshold"
}
```

**Trade entry** (written on open and close):
```json
{
  "type": "trade",
  "ts": "2026-03-22T14:00:00Z",
  "paper": true,
  "action": "open",
  "asset": "WETH",
  "direction": "long",
  "leverage": 3.0,
  "seed_usd": 100.0,
  "entry_price": 3150.00,
  "position_id": "WETH/USDC",
  "hf_after": 1.55,
  "liquidation_price": 2100.00,
  "signal": "strong_long"
}
```

```json
{
  "type": "trade",
  "ts": "2026-03-22T18:00:00Z",
  "paper": true,
  "action": "close",
  "asset": "WETH",
  "direction": "long",
  "exit_price": 3307.50,
  "exit_reason": "take_profit",
  "pnl_pct": 5.0,
  "pnl_usd": 15.00,
  "fees_usd": 0.76,
  "net_pnl_usd": 14.24
}
```

### P&L Summary

On each cycle, after writing the log, compute and output a running summary:
- Total trades (paper or live)
- Win rate %
- Total net P&L (USD)
- Average trade P&L (USD)
- Largest win / largest loss
- Current open position (if any) and unrealized P&L

## Technical Requirements

### Data Sources

- **CoinGecko API** — price and % change (1h, 24h) — free, no API key
- **CoinGecko markets endpoint** — BTC dominance
- **Aave v3 Base subgraph or REST API** — borrow rates — free
- If a data source is unavailable, skip that signal component and note it in the cycle log.
  If fewer than 2 sources are reachable, skip the run entirely.

### State / Memory

- `trades.jsonl` — append-only trade and cycle log, lives in the skill's working directory
- Entry price is stored in the trade log on open and read back on close — no external DB needed
- The agent reads the last open trade entry to know if a position is already tracked

### Configuration (top of skill, all overridable)

```
paper_trading: true
max_leverage: 3.0
base_position_pct: 0.20
take_profit_pct: 0.05
stop_loss_pct: 0.03
max_borrow_apr: 0.08
hf_reduce_threshold: 1.35
hf_close_threshold: 1.20
```

### Constraints

- Requires `aave-leverage` MCP skill installed and active.
- Stateless per run except for `trades.jsonl` — no other persistence required.
- Must degrade gracefully if a data source is down.
- Hard cap: never open with leverage > 4x regardless of config.
- Hard cap: never open if HF would be < 1.2.

## Success Criteria

- [ ] Agent pulls price trend data and computes trend score on each cycle.
- [ ] Agent correctly applies all no-trade filters (borrow APR, BTC dominance, volatility).
- [ ] Agent sizes position correctly based on signal confidence.
- [ ] Agent writes a cycle log entry on every run.
- [ ] Agent writes trade entries on open and close with entry/exit price.
- [ ] P&L summary is computed and output after each cycle.
- [ ] Paper trading mode produces identical logs without touching the chain.
- [ ] Agent reads entry price from log on close to compute accurate P&L.
- [ ] HF defense triggers reduce/close independent of signal.
- [ ] Agent skips cycle cleanly when fewer than 2 data sources are reachable.

## Out of Scope

- ML models or statistical backtesting
- CEX price data
- Multi-asset portfolio (one position at a time)
- Notification hooks (can add later)
- UI for viewing the trade log (read the JSONL directly or pipe to jq)

## Dependencies

- `aave-leverage` MCP skill (required)
- CoinGecko public API
- Aave v3 Base subgraph or REST API
- OpenClaw cron support for scheduled runs

---
*Transform to executable plan: `/create-plan .ai/PRD/aave-leverage-strategy/INITIAL.md`*
