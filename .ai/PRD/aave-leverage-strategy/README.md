# PRP: aave-leverage-strategy

## Overview

A standalone OpenClaw skill that wraps `aave-leverage` with autonomous trading logic:
market research via free public APIs, a 3-timeframe trend signal, position sizing by
confidence, paper trading mode, and a persistent `trades.jsonl` log for P&L tracking.

## Requirements from PRD

- Pull price trend (1h, 24h, 7d) and apply no-trade filters before any decision
- Built-in signal model: trend score from 3 timeframes, 4 no-trade filters on top
- Position size scales with signal confidence (full / half / no trade)
- Paper trading default — identical flow, no chain calls, logged as if executed
- Append-only `trades.jsonl`: cycle entry every run, trade entry on open/close
- P&L summary computed from log and printed after each cycle
- Stateless per run except for `trades.jsonl` — no DB, no external state

## API Research Findings

### CoinGecko (free, no key)

**Price + trend data:**
```
GET https://api.coingecko.com/api/v3/coins/markets
  ?vs_currency=usd
  &ids=ethereum,bitcoin,coinbase-wrapped-btc
  &price_change_percentage=1h,24h,7d
```

Response fields used:
- `current_price` — used for entry/exit price in paper mode
- `price_change_percentage_1h_in_currency`
- `price_change_percentage_24h_in_currency`
- `price_change_percentage_7d_in_currency`

> NOTE: 4h is NOT available on the free tier. Signal model uses 1h / 24h / 7d.

**BTC dominance:**
```
GET https://api.coingecko.com/api/v3/global
```
Response field: `data.market_cap_percentage.btc` (current %)
BTC dominance 24h change is derived by comparing to the last cycle's logged value in
`trades.jsonl` — not available directly from the API.

### DeFi Llama (free, no key)

**Aave v3 Base borrow rate proxy:**
```
GET https://yields.llama.fi/pools
```
Filter: `project == "aave-v3" && chain == "Base" && symbol == "USDC"`
Field used: `apyBase` (supply APY %)

The real USDC borrow APR is typically 1.5–3x the supply APY (depends on utilization).
For the no-trade filter threshold of 8% borrow APR, use `apyBase > 3%` as the trigger.
This is a conservative proxy — if supply yield is above 3%, borrow conditions are elevated.

Real borrow rate can also be read directly via cast if Foundry is available:
```bash
cast call 0x2d8A3C5677189723C4cB8873CfC9C8976ddf54D8 \
  "getReserveData(address)(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)" \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --rpc-url https://mainnet.base.org
```
Returns `currentVariableBorrowRate` as field 4 (Ray units, divide by 1e25 for %).
Document this as the "precise" method; DeFi Llama proxy is the "fast" method.

## Implementation Blueprint

### Repo Structure

```
openclaw-aave-leverage-strategy/
├── SKILL.md           # skill definition — the main deliverable
├── config.yml         # user-editable config (all thresholds)
├── mcp-config.json    # points to aave-leverage MCP (same URL as base skill)
├── README.md          # installation + setup guide
├── trades.jsonl       # created at runtime, gitignored
└── examples/
    └── paper-run.md   # example of one full paper trading cycle
```

### Config Schema (`config.yml`)

```yaml
# aave-leverage-strategy config
# Edit these values before your first run.

paper_trading: true          # set to false to trade with real funds

# Asset to trade (one at a time)
asset: "WETH"                # WETH | cbBTC | wstETH
position_id: "WETH/USDC"     # used by prepare_close
user_address: "0xYOUR_WALLET"

# Position sizing
max_leverage: 3.0
base_position_pct: 0.20      # fraction of wallet collateral to use as seed
strong_signal_size: 1.0      # multiplier on base_position_pct for strong signal
moderate_signal_size: 0.5    # multiplier for moderate signal

# Exit thresholds
take_profit_pct: 0.05        # close when asset up 5% from entry
stop_loss_pct: 0.03          # close when asset down 3% from entry

# No-trade filters
max_usdc_supply_apy: 3.0     # DeFi Llama proxy for high borrow cost (% APY)
max_volatility_1h: 5.0       # skip cycle if 1h move > this % in either direction
btc_dominance_rise_threshold: 2.0  # suppress longs if BTC dominance rose > this % since last cycle

# Risk guardrails
hf_reduce_threshold: 1.35    # call prepare_reduce if HF drops below this
hf_close_threshold: 1.20     # force close if HF drops below this
min_open_hf: 1.30            # don't open if projected HF would be below this
```

### Trade Log Schema (`trades.jsonl`)

Two entry types, one JSON object per line:

**Cycle entry** — written every run:
```json
{
  "type": "cycle",
  "ts": "<ISO8601>",
  "paper": true,
  "asset": "WETH",
  "current_price": 3150.00,
  "price_change_1h": 0.8,
  "price_change_24h": 1.2,
  "price_change_7d": 3.1,
  "trend_score": "strong_long",
  "usdc_supply_apy": 2.58,
  "btc_dominance_pct": 56.3,
  "btc_dominance_prev": 55.8,
  "volatility_1h_abs": 0.8,
  "filters_triggered": [],
  "decision": "open_long",
  "reason": "all 3 timeframes positive, no filters triggered",
  "position_open": false
}
```

**Trade entry** — written on open and on close:
```json
{
  "type": "trade",
  "ts": "<ISO8601>",
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
  "ts": "<ISO8601>",
  "paper": true,
  "action": "close",
  "asset": "WETH",
  "direction": "long",
  "entry_price": 3150.00,
  "exit_price": 3307.50,
  "exit_reason": "take_profit",
  "pnl_pct": 5.0,
  "pnl_usd": 15.00,
  "fees_usd": 0.76,
  "net_pnl_usd": 14.24
}
```

### Signal Model

```
trend_score = f(price_change_1h, price_change_24h, price_change_7d)

positives = count of [1h > 0, 24h > 0, 7d > 0]

if positives == 3: "strong_long"
if positives == 2: "moderate_long"
if positives == 1: "moderate_short"
if positives == 0: "strong_short"
```

No-trade filters (checked after trend score, in order):
1. `abs(price_change_1h) > max_volatility_1h` → skip cycle entirely
2. `usdc_supply_apy > max_usdc_supply_apy` → suppress all new entries
3. `btc_dominance_pct - btc_dominance_prev > btc_dominance_rise_threshold` → suppress longs only
4. Position already open in same direction → hold, don't add

### Execution Flow (per cycle)

```
1. READ config.yml
2. READ trades.jsonl → find last open position (if any) + last cycle's btc_dominance_pct
3. FETCH market data (CoinGecko prices, DeFi Llama USDC APY, CoinGecko global)
   → if < 2 sources succeed: write skipped cycle entry, exit
4. COMPUTE trend_score
5. CHECK no-trade filters
6. CHECK open position (if exists):
   a. Call get_position → get current HF, current asset price
   b. IF HF < hf_close_threshold → force close (skip signal check)
   c. ELIF HF < hf_reduce_threshold → call prepare_reduce to target hf_reduce_threshold
   d. ELIF exit conditions met (TP/SL/signal reversal) → close
7. IF no open position AND decision is to open:
   a. Compute seed_usd from wallet balance × base_position_pct × signal_size_multiplier
   b. Verify projected HF > min_open_hf
   c. IF paper mode: record open trade entry, skip execution
   d. IF live mode: call prepare_open, execute steps, record open trade entry
8. WRITE cycle entry to trades.jsonl
9. COMPUTE and PRINT P&L summary from trades.jsonl
```

### P&L Summary Computation

Read all `type == "trade"` entries from `trades.jsonl`. Pair opens with closes by
matching sequential open/close pairs on the same asset and direction.

Output:
```
=== Strategy P&L Summary ===
Mode:           paper
Total trades:   12
Open:           1 (WETH long @ $3150, unrealized: +$47.25)
Closed:         11
Win rate:       63.6% (7W / 4L)
Total net P&L:  +$84.20
Avg trade P&L:  +$7.65
Best trade:     +$31.50 (WETH long, take_profit)
Worst trade:    -$18.90 (WETH long, stop_loss)
```

## Granular Task List

### Phase 1: Repo scaffold

**Task 1 — Create repo directory structure**
- Create `openclaw-aave-leverage-strategy/` as a new sibling repo to this one
- Create empty files: `SKILL.md`, `config.yml`, `mcp-config.json`, `README.md`
- Create `.gitignore` with `trades.jsonl` (log is local, not committed)
- Create `examples/` directory

**Task 2 — Write `config.yml`**
- File: `config.yml`
- Write all config keys with defaults and inline comments per schema above
- `paper_trading: true` must be the first and most prominent setting

**Task 3 — Write `mcp-config.json`**
- File: `mcp-config.json`
- Copy from base skill: `{"mcpServers": {"aave-leverage": {"url": "https://aave-leverage-agent-production.up.railway.app/mcp", "headers": {"X-Wallet-Address": "0xYOUR_WALLET_ADDRESS"}}}}`

### Phase 2: SKILL.md — frontmatter and capability overview

**Task 4 — Write SKILL.md frontmatter**
- Pattern: follow `SKILL.md:1-8` in the base skill repo
```yaml
---
name: aave-leverage-strategy
description: Autonomous trend-following strategy for Aave v3 leverage on Base. Paper trading + live mode. Persistent P&L log.
version: 1.0.0
author: gutdraw
tags: [defi, aave, leverage, base, crypto, trading, autonomous, strategy]
requires_skill: aave-leverage
---
```

**Task 5 — Write capability overview section**
- What the skill does in one paragraph
- List: paper trading, trend signal, position sizing, TP/SL/HF defense, P&L log
- Supported assets table (WETH, cbBTC, wstETH — same as base skill)

### Phase 3: SKILL.md — configuration section

**Task 6 — Write configuration section**
- Document all `config.yml` keys with type, default, and plain-English description
- Emphasize `paper_trading: true` default and how to go live
- Note: `user_address` must be set before first run

### Phase 4: SKILL.md — market research section

**Task 7 — Write market research instructions**
- Step-by-step: what to fetch, from where, in what order
- CoinGecko endpoint: exact URL with all query params
  - `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=<coingecko_id>&price_change_percentage=1h,24h,7d`
  - CoinGecko IDs by asset: WETH → `ethereum`, cbBTC → `coinbase-wrapped-btc`, wstETH → `wrapped-steth`
- DeFi Llama endpoint: `https://yields.llama.fi/pools` → filter for `project=aave-v3, chain=Base, symbol=USDC` → read `apyBase`
- CoinGecko global: `https://api.coingecko.com/api/v3/global` → read `data.market_cap_percentage.btc`
- Fallback: if any source fails, log which one failed, continue with remaining sources
- Hard stop: if fewer than 2 sources succeed, write `"decision": "skip_insufficient_data"` to cycle log and exit

**Task 8 — Write borrow rate section**
- Primary method: DeFi Llama `apyBase` proxy (no key, fast)
  - Threshold mapping: `apyBase > 3%` → suppress entries (proxy for borrow APR > 8%)
- Precise method: `cast call` to Aave PoolDataProvider (requires Foundry)
  - Document exact cast command with contract address and return field index
  - Note: divide Ray value by 1e25 to get % APR
- Skill uses primary by default; precise method is noted for power users

### Phase 5: SKILL.md — signal model section

**Task 9 — Write trend score computation**
- Exactly as defined in blueprint: count positives across 1h, 24h, 7d
- Table: 3 positive = strong_long, 2 = moderate_long, 1 = moderate_short, 0 = strong_short
- Example: "ETH is +0.8% (1h), +1.2% (24h), -0.5% (7d) → 2 positives → moderate_long"

**Task 10 — Write no-trade filters section**
- Four filters in priority order with exact threshold references to `config.yml` keys
- For each filter: what triggers it, what it suppresses, and why
- BTC dominance filter: explain how to derive 24h change from `trades.jsonl` last cycle entry

### Phase 6: SKILL.md — position sizing section

**Task 11 — Write position sizing section**
- Base size formula: `seed_usd = wallet_collateral_balance_usd × base_position_pct × signal_multiplier`
- Signal multiplier: strong = `strong_signal_size` (default 1.0), moderate = `moderate_signal_size` (default 0.5)
- How to get wallet balance: call `get_position`, read `total_collateral_usd`; if no position open, use token balances
- Pre-open check: verify projected HF > `min_open_hf` — if not, skip and log reason

### Phase 7: SKILL.md — execution flow section

**Task 12 — Write per-cycle execution flow**
- Numbered step-by-step matching the blueprint above (9 steps)
- Call out paper vs live branching explicitly at step 7
- Include what to do if a tx step fails: log error, do not retry in same cycle, exit

**Task 13 — Write exit rules section**
- TP/SL: how to detect (compare current_price to `entry_price` from last trade log entry)
- Signal reversal: trend_score flips direction from open trade's `signal` field
- HF defense: always checked first, overrides all other exit logic
- For each exit reason: document the `exit_reason` string written to the log

### Phase 8: SKILL.md — trade log section

**Task 14 — Write trade log section**
- Explain `trades.jsonl`: append-only, one JSON per line, lives next to `config.yml`
- Document both entry schemas (cycle and trade) exactly as defined in blueprint
- How to read the log to find last open position: scan backwards for `type=trade, action=open` with no matching close
- Note: file is gitignored — operator is responsible for backup

**Task 15 — Write P&L summary section**
- How summary is computed (pair opens/closes, sum net_pnl_usd)
- Exact output format from blueprint
- How unrealized P&L is computed: `(current_price - entry_price) / entry_price × seed_usd × leverage`
- Note: fees are estimated for paper trades (use fee formula from base skill: flash 0.09% × 2 + swap 0.05% × 2 + protocol 0.10%)

### Phase 9: SKILL.md — paper trading and safety sections

**Task 16 — Write paper trading section**
- What changes in paper mode (nothing except execution step is skipped)
- How to validate paper results before going live
- Recommended: run at least 20 paper cycles across different market conditions before live
- How to switch to live: change `paper_trading: false` in `config.yml`

**Task 17 — Write safety and hard limits section**
- Hard limits that override config:
  - Never open with leverage > 4x
  - Never open if projected HF < 1.2
  - Never more than one open position at a time
  - On any unhandled error: log and exit without acting
- Reference base skill's contract addresses for verification

### Phase 10: Supporting files

**Task 18 — Write `examples/paper-run.md`**
- Show one complete cycle: market data fetched, trend score computed, filters checked,
  position opened (paper), cycle entry logged, P&L summary printed
- Use realistic but illustrative numbers
- Show the exact JSON written to `trades.jsonl`

**Task 19 — Write `README.md`**
- Installation: requires `aave-leverage` skill + this skill
- Setup: edit `config.yml` (user_address, asset, paper_trading)
- First run instructions
- How to read the P&L log (`cat trades.jsonl | jq 'select(.type=="trade")'`)
- How to go live once paper trading is validated

**Task 20 — Initialize `.gitignore`**
```
trades.jsonl
config.yml        # contains wallet address — don't commit
```

## Validation Gating Criteria

### Manual verification checklist

After building `SKILL.md`, walk through these scenarios mentally (or with a test run):

- [ ] **Paper open**: Run one cycle with all 3 timeframes positive. Verify cycle entry is written with `decision: open_long` and trade entry is written with `action: open`. No chain calls made.
- [ ] **No-trade filter: volatility**: Simulate 1h change = +6%. Verify decision is `skip_volatility` and no trade entry is written.
- [ ] **No-trade filter: borrow cost**: Simulate `apyBase = 4.5%`. Verify decision is `skip_borrow_cost`.
- [ ] **TP exit**: Simulate current_price 5.1% above entry_price. Verify close entry is written with `exit_reason: take_profit`.
- [ ] **SL exit**: Simulate current_price 3.1% below entry_price. Verify close entry with `exit_reason: stop_loss`.
- [ ] **HF defense**: Simulate `get_position` returning HF = 1.15. Verify force close is triggered regardless of signal.
- [ ] **Insufficient data**: Simulate CoinGecko down + DeFi Llama down. Verify cycle is skipped.
- [ ] **P&L summary**: With 3 closed trades (2 wins, 1 loss), verify win rate = 66.7% and totals are correct.
- [ ] **Config respected**: Change `max_leverage: 2.0` and verify prepare_open is called with leverage ≤ 2.0.

### Structural checks

- [ ] Every section in the execution flow (9 steps) is covered in `SKILL.md`
- [ ] All `config.yml` keys are documented in the configuration section
- [ ] Both cycle and trade log schemas match the blueprint exactly
- [ ] `trades.jsonl` and `config.yml` are in `.gitignore`
- [ ] CoinGecko ID mapping for all 3 supported assets is documented

## Integration Points

- **Base skill dependency**: `requires_skill: aave-leverage` in frontmatter
- **MCP tools used**: `get_position`, `prepare_open`, `prepare_close`, `prepare_reduce`
- **Base skill's agent behavior rules** (`SKILL.md:224-234`): the strategy skill inherits these — HF warning, liquidation price in dollar terms, etc.
- **MCP server URL**: same as base skill — `https://aave-leverage-agent-production.up.railway.app/mcp`

## Reference Implementations

- Skill frontmatter pattern: `../openclaw-aave-leverage/SKILL.md:1-8`
- Fee formula for paper trade cost estimation: `../openclaw-aave-leverage/SKILL.md:204-212`
- Contract addresses for safety section: `../openclaw-aave-leverage/SKILL.md:193-202`
- Log schema: defined in this PRP — no prior reference exists

## Success Criteria

- [ ] All 20 tasks completed
- [ ] All manual verification scenarios pass
- [ ] All structural checks pass
- [ ] `config.yml` defaults result in paper trading mode with no chain calls
- [ ] `trades.jsonl` format is exactly as specified — no extra or missing fields

---
*Execute with: `/execute-plan .ai/PRD/aave-leverage-strategy/README.md`*
