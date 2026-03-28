# Agent-Driven Improvement Loop

The strategy bot produces a rich structured log every cycle. An LLM agent can
read this log, reason about what the bot is doing, and propose improvements —
closing the loop between execution and strategy refinement.

## Architecture

```
Bot (EC2, always on)              Agent (LLM, periodic)
┌────────────────────────┐        ┌──────────────────────────────┐
│ fetch data             │        │ read trades.jsonl            │
│ score signal           │        │ analyze performance          │
│ call MCP (this skill)  │  ───►  │ form hypothesis              │
│ append trades.jsonl    │        │ propose config/code changes  │
└────────────────────────┘        └──────────────────────────────┘
         ▲                                      │
         └──── human reviews → merges PR ───────┘
```

The bot runs continuously and never calls an LLM. The agent is periodic — it reads
what the bot produced and reasons about it. They never share a code path.

## What the agent reads

Each cycle appends a JSON entry to `trades.jsonl`. Key fields:

```json
{
  "type": "cycle",
  "ts": "2026-03-28T03:17:25Z",
  "price": 66083.0,
  "signal": "strong_short",
  "tech_rsi": 33.2,
  "tech_ema_bull": false,
  "unrealised_usd": 83.68,
  "unrealised_pct": 2.09,
  "health_factor": 1.219,
  "short_carry_apr": 5.75,
  "fear_greed": 12,
  "funding_rate": -0.0029,
  "decision": "skip_already_open"
}
```

Trade open/close entries contain `entry_price`, `close_price`, `realised_usd`, `reason`.

## What the agent can do

### Performance analysis
Read all closed trades and compute:
- Win rate by signal label (`strong_long`, `moderate_short`, etc.)
- Distribution of exit reasons (`stop_loss`, `take_profit`, `signal_reversal`, `hf_close`)
- Avg P&L per trade, per signal, per direction
- Carry drag vs realised P&L

Example finding: *"Stop-losses are 68% of exits on moderate_long trades. RSI at entry
was typically 40–45 — just above the bull floor. Consider raising `RSI_BULL_LOW` from
40 to 45 to require stronger momentum before entering."*

### Parameter tuning
Propose changes to `config.yml` or signal thresholds:
- `take_profit_pct`, `stop_loss_pct`
- `leverage`, `base_position_pct`
- `max_borrow_apr`, `max_fear_greed_long`, `min_fear_greed_short`
- RSI/EMA thresholds in `ohlcv.py`
- Filter floors in `filters.py`

### Code changes
For changes beyond config (new indicators, exit conditions, new data sources),
the agent reads the relevant source files, proposes a diff, and opens a PR.

### Anomaly detection
Flag unexpected patterns in the log:
- HF dropping faster than price move implies (leverage miscalculation)
- P&L inconsistent with borrow size (entry price weighting issue)
- Signal firing every cycle without position change (filter always blocking)
- Carry APR swinging unexpectedly (rate spike on Aave)

## The improvement workflow

```
1. Agent reads trades.jsonl
2. Agent identifies a pattern with supporting data from the log
3. Agent proposes a specific change with a stated reason
4. Human reviews the reasoning and the proposed diff/config change
5. Human approves → commit → EC2 pulls → bot runs with new parameters
6. Agent checks next N cycles to confirm the change had the intended effect
```

Human-in-the-loop for all changes. The agent proposes, the human decides.
This prevents runaway self-modification and keeps the audit trail clean.

## What requires human approval (always)

| Change type | Why |
|---|---|
| `paper_trading: false` | Switching to live is irreversible mid-cycle |
| New signal sources | Changes what data the bot trusts |
| HF defense thresholds | Wrong values can cause liquidation |
| Leverage cap | Risk boundary |
| Asset or direction | Fundamental strategy change |

## What the agent can propose safely

| Change type | Notes |
|---|---|
| TP/SL percentages | Bounded by position math — can't cause liquidation |
| RSI/EMA thresholds | Signal score adjustments |
| Filter thresholds | Only suppresses entries, never forces them |
| `base_position_pct` | Affects size, not direction |
| Logging fields | Additive, no execution impact |

## Running the agent

Any LLM with file access can act as the reviewer. Minimal prompt:

```
Read trades.jsonl in the openclaw-aave-leverage-strategy repo.
Analyze the last 30 days of cycle and trade entries.
Report: win rate by signal, exit reason distribution, avg P&L per trade.
Identify one specific improvement with supporting data from the log.
Propose the exact config change or code diff needed.
```

For Hermes 3 or any OpenAI-compatible model, see `HERMES_SYSTEM_PROMPT.md` for the
full system prompt including MCP tool usage and Layer 2 reviewer guidelines.
