# Self-Improvement Loop — Hermes + Aave Strategy

Hermes can autonomously evaluate its own trading performance, propose parameter
improvements, verify them against historical data, and apply them — all without
human intervention. This document explains how to set it up and what the loop looks like.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Hermes 3 (local via Ollama)                                    │
│                                                                 │
│  tools.json ──► MCP server (aave-leverage-agent)               │
│              ──► Improve server (localhost:8001)                │
└─────────────────────────────────────────────────────────────────┘
       │                           │
       ▼                           ▼
  get_position              analyze_performance
  prepare_open/close        backtest
  (live trading tools)      update_config
```

Two servers run side by side:
- **MCP server** (`aave-leverage-agent-production.up.railway.app`) — live trading tools
- **Improve server** (`localhost:8001`) — analytics, backtesting, config updates

## Starting the improve server

```bash
cd openclaw-aave-leverage-strategy
python3 -m bot.improve_server --config config.yml --port 8001
```

Runs alongside the trading bot. Binds to `127.0.0.1` only — not exposed externally.

## The self-improvement loop

Hermes runs this loop on demand or on a schedule (e.g. every 24 hours or every 50 cycles):

### Step 1 — Analyze current performance
```
Hermes calls: analyze_performance()

Returns:
{
  "win_rate": 0.52,
  "total_pnl_usd": 84.20,
  "by_signal": {
    "strong_long":   {"win_rate": 0.71, "trades": 7},
    "moderate_long": {"win_rate": 0.40, "trades": 5},
    "strong_short":  {"win_rate": 0.33, "trades": 3},
    ...
  },
  "exit_reasons": {"stop_loss": 8, "take_profit": 5},
  "hints": [
    "stop_loss_pct may be too tight — stop-losses represent 62% of exits",
    "strong_long has strong win rate (71%). Consider increasing take_profit_pct."
  ]
}
```

### Step 2 — Form a hypothesis
Hermes reads the hints and exit_reasons and reasons about what to change.

Example reasoning:
> "Stop-losses are 62% of exits and strong_long has 71% win rate.
> The position is being stopped out too early on pullbacks.
> I should test a wider stop-loss (4% instead of 3%) and higher TP (7% instead of 5%)."

### Step 3 — Verify with backtest
```
Hermes calls: backtest(
  stop_loss_pct=4.0,
  take_profit_pct=7.0,
  compare_to_baseline=true,
  seed_usd=1000.0
)

Returns:
{
  "baseline": {"win_rate": 0.52, "total_pnl_usd": 84.20, "avg_pnl_usd": 7.65},
  "proposed": {"win_rate": 0.58, "total_pnl_usd": 112.40, "avg_pnl_usd": 9.37},
  "delta":    {"win_rate": +0.06, "total_pnl_usd": +28.20, "verdict": "improvement"}
}
```

### Step 4 — Apply if improvement confirmed
```
Hermes calls: update_config(
  changes={"stop_loss_pct": 4.0, "take_profit_pct": 7.0},
  reason="Backtest shows +$28.20 total P&L improvement. Stop-losses were 62% of exits,
          suggesting stop was too tight. Wider SL/TP improves win rate from 52% to 58%."
)

Returns:
{
  "success": true,
  "applied": {"stop_loss_pct": 4.0, "take_profit_pct": 7.0},
  "rejected": {},
  "message": "Applied 2 change(s)"
}
```

### Step 5 — Run more paper cycles, then re-evaluate
The bot continues running with new parameters. After another N cycles, Hermes
calls `analyze_performance()` again to verify the real-world improvement matches
the backtest prediction.

---

## Safety guardrails built into the loop

| Guardrail | Mechanism |
|---|---|
| Can't go live accidentally | `update_config` blocked if `paper_trading: false` |
| Can't set dangerous leverage | Hard bounds: leverage ≤ 4.0 |
| Can't blow up sizing | `base_position_pct` capped at 0.50 |
| Can't invert HF defense | `hf_defense_close` must be < `hf_defense_reduce` |
| Every change is auditable | All changes logged to `config_changes.jsonl` with reason |
| Backtest before apply | Hermes system prompt requires backtest first |
| No blind reversion | Change history shows what was tried and why |

---

## Hermes system prompt addition

Add this section to the system prompt from `HERMES_SYSTEM_PROMPT.md` to enable
the self-improvement behaviour:

```
## Self-improvement loop

You have access to three additional tools via the local improve server:
- analyze_performance: read your own trade history and get performance metrics + hints
- backtest: replay historical prices with different parameters to test hypotheses
- update_config: apply validated parameter changes (paper mode only)

Self-improvement rules:
1. Run analyze_performance at the start of every improvement session.
2. Always form a hypothesis based on the data before proposing changes.
   Cite specific numbers: "stop-losses are 62% of exits, suggesting X".
3. Always run backtest with compare_to_baseline=true before update_config.
   Only apply changes that show a positive delta in total_pnl_usd.
4. Never apply more than 2 parameter changes at once.
   Isolate variables so you know what caused the improvement.
5. After applying changes, note what you changed and why in your response.
   The reason field in update_config is logged permanently — write a clear explanation.
6. Do not apply changes if the backtest shows fewer than 5 simulated trades.
   There is not enough data to be confident.
7. After N more paper cycles, re-run analyze_performance and compare to the
   pre-change baseline to validate the improvement held in real market conditions.
```

---

## Running Hermes locally with Ollama

```bash
# Pull Hermes 3
ollama pull hermes3

# Start the improve server
cd openclaw-aave-leverage-strategy
python3 -m bot.improve_server &

# Run Hermes with both tool sets
python3 - <<'EOF'
import json
import requests

tools = json.load(open("../openclaw-aave-leverage/tools.json"))
system = open("../openclaw-aave-leverage/HERMES_SYSTEM_PROMPT.md").read()

messages = [
    {"role": "system", "content": system},
    {"role": "user", "content": "Analyze my trading performance and suggest improvements."},
]

response = requests.post(
    "http://localhost:11434/v1/chat/completions",
    json={"model": "hermes3", "messages": messages, "tools": tools, "tool_choice": "auto"},
)

msg = response.json()["choices"][0]["message"]
print(msg)
EOF
```

---

## What Hermes can and cannot change

### Can change (via update_config)
- `take_profit_pct`, `stop_loss_pct`
- `leverage`
- `base_position_pct`, `strong_signal_size`, `moderate_signal_size`
- `max_borrow_apr`, `max_volatility_1h`, `btc_dominance_rise_threshold`
- `hf_defense_reduce`, `hf_defense_close`, `min_open_hf`

### Cannot change (requires human)
- `asset`, `borrow_asset`, `short_borrow_asset` — changes the strategy fundamentally
- `user_address`, `mcp_session_token`, `private_key` — identity and secrets
- `paper_trading` — switching to live is a human decision
- The signal model itself (`signal.py`) — algorithmic changes require code review

The boundary is intentional: Hermes tunes the *parameters* of a known strategy.
It doesn't rewrite the strategy. Changing the signal model, adding new data sources,
or going live are human decisions.
