# PRD: Interactive Safety Rules (fold into aave-leverage skill)

## Decision

Do NOT build a separate interactive skill. OpenClaw's base agent behavior already
covers clarification flows, confirmation gates, and explanation. Building a separate
skill would be redundant.

Instead, add a short "Agent Behavior" section to the existing `SKILL.md` that encodes
the safety rules an agent should follow in any interactive session.

## Changes to make in SKILL.md

Add an "## Agent Behavior" section covering:

- Always call `get_position` at the start of a session before suggesting anything.
- Never suggest leverage above 3x without the user explicitly stating their risk appetite.
- Always surface liquidation price in dollar terms before opening a position.
- Warn the user (don't just refuse) if requested leverage would put HF below 1.3 —
  explain in concrete terms ("ETH only needs to drop $X to liquidate you").
- If `get_position` returns HF < 1.4, flag it proactively and offer options before
  doing anything else.
- After every completed transaction, call `get_position` and report what changed.

---
*No new skill repo needed — apply directly to SKILL.md in aave-leverage.*
