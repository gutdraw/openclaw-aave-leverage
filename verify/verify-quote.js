#!/usr/bin/env node
/**
 * verify-quote.js
 *
 * Independently verify a Uniswap v3 QuoterV2 quote returned by the
 * aave-leverage-agent MCP server against your own RPC endpoint.
 *
 * Usage:
 *   node verify-quote.js --provenance '<JSON>' [--rpc <rpc_url>] [--tolerance <bps>]
 *
 * Examples:
 *   node verify-quote.js --provenance '{"fn":"quoteExactInputSingle","token_in":"0x833...","token_out":"0xcbB...","amount_in":6494200,"fee":500,"raw_quote":62160,"slippage_bps":50,"min_out":61847}' --rpc https://mainnet.base.org
 *
 * Exit codes:
 *   0 — quote verified, safe to sign
 *   1 — quote mismatch or error, do NOT sign
 */

const { execSync } = require("child_process");

const QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

// QuoterV2 ABI fragments (quoteExactInputSingle + quoteExactOutputSingle)
const QUOTER_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    name: "quoteExactOutputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { rpc: "https://mainnet.base.org", toleranceBps: 100 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provenance") result.provenance = JSON.parse(args[++i]);
    if (args[i] === "--rpc") result.rpc = args[++i];
    if (args[i] === "--tolerance") result.toleranceBps = parseInt(args[++i]);
  }
  return result;
}

async function callQuoter(rpc, fn, params) {
  // Use cast (Foundry) if available, otherwise fall back to eth_call via curl
  try {
    if (fn === "quoteExactInputSingle") {
      const cmd = `~/.foundry/bin/cast call ${QUOTER_V2} \
        "quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)" \
        "(${params.tokenIn},${params.tokenOut},${params.amountIn},${params.fee},0)" \
        --rpc-url ${rpc} 2>/dev/null`;
      const out = execSync(cmd, { encoding: "utf8" }).trim();
      return BigInt(out.split("\n")[0].split(" ")[0]);
    } else {
      const cmd = `~/.foundry/bin/cast call ${QUOTER_V2} \
        "quoteExactOutputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)" \
        "(${params.tokenIn},${params.tokenOut},${params.amount},${params.fee},0)" \
        --rpc-url ${rpc} 2>/dev/null`;
      const out = execSync(cmd, { encoding: "utf8" }).trim();
      return BigInt(out.split("\n")[0].split(" ")[0]);
    }
  } catch (e) {
    throw new Error(
      `cast call failed: ${e.message}. Make sure Foundry is installed: https://getfoundry.sh`,
    );
  }
}

async function main() {
  const { provenance: p, rpc, toleranceBps } = parseArgs();

  if (!p) {
    console.error(
      "Usage: node verify-quote.js --provenance '<JSON>' [--rpc <url>] [--tolerance <bps>]",
    );
    process.exit(1);
  }

  console.log(`\nVerifying quote via ${rpc}`);
  console.log(`Function  : ${p.fn}`);
  console.log(`Token in  : ${p.token_in}`);
  console.log(`Token out : ${p.token_out}`);
  console.log(`Fee       : ${p.fee}`);

  let ourQuote, params;

  if (p.fn === "quoteExactInputSingle") {
    ourQuote = BigInt(p.raw_quote);
    params = {
      tokenIn: p.token_in,
      tokenOut: p.token_out,
      amountIn: p.amount_in,
      fee: p.fee,
    };
    console.log(`Amount in : ${p.amount_in}`);
    console.log(`Server raw_quote : ${p.raw_quote}`);
  } else if (p.fn === "quoteExactOutputSingle") {
    ourQuote = BigInt(p.collateral_needed);
    params = {
      tokenIn: p.token_in,
      tokenOut: p.token_out,
      amount: p.amount_out,
      fee: p.fee,
    };
    console.log(`Amount out (target) : ${p.amount_out}`);
    console.log(`Server collateral_needed : ${p.collateral_needed}`);
  } else {
    console.error(`Unknown fn: ${p.fn}`);
    process.exit(1);
  }

  let yourQuote;
  try {
    yourQuote = await callQuoter(rpc, p.fn, params);
  } catch (e) {
    console.error(`\nQuoter call failed: ${e.message}`);
    process.exit(1);
  }

  console.log(`Your independent quote : ${yourQuote.toString()}`);

  // Check within tolerance
  const diff =
    ourQuote > yourQuote ? ourQuote - yourQuote : yourQuote - ourQuote;
  const diffBps = Number((diff * 10000n) / (ourQuote || 1n));

  console.log(`Difference : ${diffBps} bps (tolerance: ${toleranceBps} bps)`);

  if (diffBps <= toleranceBps) {
    console.log(`\nRESULT: PASS ✓ — quote verified, safe to sign`);
    process.exit(0);
  } else {
    console.log(
      `\nRESULT: FAIL ✗ — quote mismatch exceeds ${toleranceBps}bps tolerance, do NOT sign`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
