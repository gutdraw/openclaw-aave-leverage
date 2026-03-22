# PRD: aave-leverage-autonomous

## Problem Statement

The `aave-leverage` MCP skill gives an agent the tools to execute leveraged positions but no decision-making framework for running unattended. Users who want to run automated trading bots — executing on signals, monitoring positions, and managing risk without human confirmation — have no skill that defines the rules, guardrails, and operational behavior needed to do this safely and profitably.

## User Stories

- As a developer running a trading bot, I want the agent to open and close positions based on defined signal inputs, so I can automate a strategy without writing custom integration code.
- As a bot operator, I want the agent to continuously monitor health factor and automatically reduce leverage or close if it drops below a threshold, so I don't get liquidated while I'm away.
- As a bot operator, I want strict position sizing rules enforced by the skill, so the agent never risks more than I've configured in a single position.
- As a developer, I want the agent to log every decision and action with reasoning, so I can audit what happened and tune the strategy.
- As a bot operator, I want the agent to handle RPC failures, quote errors, and transaction reverts gracefully with retries and fallbacks, so the bot doesn't get stuck or leave a half-open position.

## Functional Requirements

### Core Features

- **Signal intake**: Accept a structured signal (asset, direction, strength/confidence) as input and decide whether to open, hold, or close based on configured rules.
- **Position monitoring loop**: On each run, call `get_position`, evaluate health factor and current P&L direction, and act according to risk rules without human input.
- **Risk guardrails (configurable)**:
  - Max leverage per position (default: 3x)
  - Max % of wallet in a single position (default: 25%)
  - Minimum health factor before forced reduce (default: 1.35)
  - Minimum health factor before forced close (default: 1.2)
  - Max number of concurrent open positions (default: 1)
- **Automatic health factor defense**: If HF falls below the reduce threshold, call `prepare_reduce` to bring leverage down. If it falls below the close threshold, call `prepare_close`.
- **Entry rules**: Only open a new position if no position is already open in the same asset pair, wallet has sufficient seed collateral, and HF of resulting position would be above the configured minimum.
- **Exit rules**: Close on signal reversal, on stop-loss trigger (configurable % move against position), or on take-profit trigger (configurable % move in position's favor).
- **Structured logging**: Every decision (open/hold/close/skip) must be logged with timestamp, reason, position state snapshot, and action taken.
- **Dry-run mode**: Execute all logic and log all decisions without calling any on-chain tools — for testing strategy without risking funds.

### Operational Behavior

- Designed to be called on a cron schedule (e.g. every 5–15 minutes).
- Each run is stateless — the agent reads current on-chain state via `get_position` and acts from that.
- If a transaction fails, log the error, do not retry more than once per run, and flag for operator review.
- Never leave a position in a state where debt exists but collateral has been withdrawn — validate pre/post state.

## Technical Requirements

### Constraints

- Requires `aave-leverage` MCP skill installed and active.
- All risk parameters must be configurable at the top of the skill — no hardcoded values in decision logic.
- Must be safe to run on a cron with no human in the loop.
- Must handle the case where `get_position` shows a position the current run didn't open (e.g. opened manually) — respect it, don't close it unless risk rules require.

### Safety Guardrails (Non-Negotiable)

- Hard cap: never open a position with leverage > 4x regardless of configuration.
- Hard cap: never open if resulting HF would be < 1.2 (server enforces 1.1 — skill adds 0.1 buffer).
- Never execute more than one open and one close per run cycle to limit blast radius.
- On any unexpected error or ambiguous state, log and exit without acting — fail safe, not fail open.

### Performance

- Each run should complete within 60 seconds under normal conditions.
- `get_position` is always called first — never act on stale state.

## Integration Points

- **`aave-leverage` MCP**: All on-chain actions go through this skill's tools (`get_position`, `prepare_open`, `prepare_close`, `prepare_reduce`, `prepare_increase`).
- **Signal source**: The skill defines the signal schema but is agnostic to source — signal can come from another agent, an API call, or a hardcoded strategy rule.
- **Cron / scheduler**: Designed to be invoked by OpenClaw's cron feature or any external scheduler.

## Success Criteria

- [ ] Agent correctly opens a position when a valid signal is provided and no position is open.
- [ ] Agent correctly skips opening when risk rules are violated (wallet too small, leverage too high, position already open).
- [ ] Agent automatically reduces leverage when HF drops below the reduce threshold.
- [ ] Agent automatically closes when HF drops below the close threshold.
- [ ] Agent exits cleanly without acting on any unexpected error or ambiguous state.
- [ ] Dry-run mode produces correct logs without touching the chain.
- [ ] All decisions are logged with full reasoning and position state.

## Out of Scope

- Price feed integration or signal generation — the skill consumes signals, it doesn't generate them.
- Multi-wallet management.
- Cross-chain positions (Base only).
- Interactive explanation or confirmation flows (that's `aave-leverage-interactive`).
- Backtesting.

## Dependencies

- `aave-leverage` MCP skill (required)
- OpenClaw cron support (for scheduled runs)

## Open Questions

- Should the skill define one reference strategy (e.g. simple momentum) as a default, or be purely signal-agnostic and require the operator to provide signal logic externally?
- Should stop-loss and take-profit be based on the underlying asset price or on the position's health factor movement?
- How should partial closes be handled for take-profit — close 50% at target, or always full close?
- Should the skill support a Telegram/Slack notification hook so the operator gets alerted on every action taken?

---
*Transform to executable plan: `/create-plan .ai/PRD/aave-leverage-autonomous/INITIAL.md`*
