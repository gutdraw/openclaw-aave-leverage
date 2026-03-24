# Changelog

## [1.0.0] — 2026-03-24

### Added
- `get_position`: live Aave v3 position state, health factor, balances, rates
- `chat`: natural-language leverage intents (open, close, adjust)
- `prepare_open`: structured open for bots — returns ordered transaction steps
- `prepare_close`: structured close — flash-loan repay + collateral withdraw
- `prepare_reduce`: reduce leverage without closing
- `prepare_increase`: increase leverage without closing
- `swap`: Uniswap v3 token swaps on Base
- `tools.json`: OpenAI-compatible function schema for Hermes and other LLMs
- `HERMES_SYSTEM_PROMPT.md`: system prompt + usage examples for Hermes 3
- `TERMS.md`: Terms of Service with financial risk disclosures
- `SETUP.md`: installation and configuration guide
- LeverageRouterV3 + LeverageVaultV3 contracts (Base mainnet, verified on Basescan)
- 48-hour timelock on all admin functions
- x402 USDC micropayment for MCP session access
