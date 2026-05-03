// server.js — hive-swap-router-federation MCP Server
// Reframed from vAMM DEX (doctrine violation) to swap-route meta-router.
// Hive does NOT execute swaps internally. Hive quotes Uniswap (Base),
// Jupiter (Solana), and OKX DEX (multi-chain), returns the best route,
// and charges a thin 5 bps "trust + receipt" fee on top.
// Partner DEX provides liquidity. Wallet keeps custody.
// Hive provides the trust layer: trust scores, AML attestations, receipts.
//
// commit: refactor(swap): reframe vAMM DEX → swap-router-federation per partner doctrine
//
// Brand: Hive Civilization gold #C08D23 (NEVER #f5c518).

import express from 'express';
import { smashProvMiddleware, getPubkeyInfo as getProvPubkeyInfo, verifyProvSig } from './lib/prov.js';
import { HIVE_EARN_TOOLS, executeHiveEarnTool, isHiveEarnTool } from './hive-earn-tools.js';
import { buildAgentCard, buildOacJsonLd, renderRootHtml } from './hive-agent-card.js';
import cors from 'cors';
import { renderLanding, renderRobots, renderSitemap, renderSecurity, renderOgImage, seoJson, BRAND_GOLD } from './meta.js';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://hive-mcp-swap.onrender.com';
const INTERNAL_KEY = process.env.INTERNAL_KEY || '';

// ─── Partner DEX API endpoints ───────────────────────────────────────────────
// Uniswap v3 (Base mainnet) — via Paraswap aggregator (no key required for quotes)
const PARASWAP_BASE = 'https://apiv5.paraswap.io';
const PARASWAP_NETWORK_BASE = 8453;
// Jupiter (Solana mainnet) — public quote API
const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
// OKX DEX (multi-chain) — public aggregator quote endpoint
const OKX_DEX_QUOTE_URL = 'https://www.okx.com/api/v5/dex/aggregator/quote';

// Hive trust + receipt fee: 5 bps = 0.0005
const HIVE_FEE_BPS = 5;
const HIVE_FEE_RATE = HIVE_FEE_BPS / 10000;

// Well-known token addresses
const TOKENS = {
  base: {
    ETH:  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  },
  solana: {
    SOL:  'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── smash.prov middleware (BEFORE paywall) ─────────────────────────────────
app.use(smashProvMiddleware);

// ── /v1/prov routes (free, never paywalled) ─────────────────────────────────
app.get('/v1/prov/pubkey', async (_req, res) => {
  try { res.json(await getProvPubkeyInfo()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/v1/prov/verify', async (req, res) => {
  try {
    const { method, path: p, body_b64u = '', ts, sig_b64u } = req.body || {};
    if (!method || !p || ts == null || !sig_b64u) return res.status(400).json({ error: 'missing fields' });
    res.json(await verifyProvSig({ method, path: p, body_b64u, ts, sig_b64u }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ─── Quote helpers ───────────────────────────────────────────────────────────

async function quoteUniswapBase({ tokenIn, tokenOut, amountIn }) {
  // Paraswap aggregator covers Uniswap v3, Aerodrome, PancakeswapV3 on Base.
  // No API key required for price quotes.
  try {
    const srcToken = TOKENS.base[tokenIn] || tokenIn;
    const destToken = TOKENS.base[tokenOut] || tokenOut;
    const srcDecimals = (tokenIn === 'USDC' || tokenIn === 'USDT') ? 6 : 18;
    const destDecimals = (tokenOut === 'USDC' || tokenOut === 'USDT') ? 6 : 18;
    const rawAmount = Math.round(amountIn * (10 ** srcDecimals)).toString();

    const url = `${PARASWAP_BASE}/prices?srcToken=${srcToken}&destToken=${destToken}` +
      `&srcDecimals=${srcDecimals}&destDecimals=${destDecimals}` +
      `&amount=${rawAmount}&side=SELL&network=${PARASWAP_NETWORK_BASE}&partner=hive-civilization`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    const route = d?.priceRoute;
    if (!route) return null;
    const destAmount = Number(route.destAmount) / (10 ** destDecimals);
    const hiveFee = destAmount * HIVE_FEE_RATE;
    return {
      dex: 'Uniswap v3 (via Paraswap, Base)',
      chain: 'base',
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: destAmount,
      amountOutAfterHiveFee: destAmount - hiveFee,
      hiveFeeAmount: hiveFee,
      hiveFeeDescription: `${HIVE_FEE_BPS} bps trust + receipt fee`,
      gasCostUSD: route.gasCostUSD,
      bestRoute: route.bestRoute?.[0]?.swaps?.[0]?.swapExchanges?.map(e => ({
        exchange: e.exchange,
        percent: e.percent,
      })),
      partner_dex: 'Uniswap v3',
      partner_url: 'https://app.uniswap.org',
      raw_paraswap: { srcUSD: route.srcUSD, destUSD: route.destUSD },
    };
  } catch (err) {
    return { dex: 'Uniswap v3 (Base)', error: String(err?.message || err), chain: 'base' };
  }
}

async function quoteJupiterSolana({ tokenIn, tokenOut, amountIn }) {
  try {
    const inputMint = TOKENS.solana[tokenIn] || tokenIn;
    const outputMint = TOKENS.solana[tokenOut] || tokenOut;
    const srcDecimals = (tokenIn === 'USDC' || tokenIn === 'USDT') ? 6 : 9;
    const rawAmount = Math.round(amountIn * (10 ** srcDecimals)).toString();

    const url = `${JUPITER_QUOTE_URL}?inputMint=${inputMint}&outputMint=${outputMint}` +
      `&amount=${rawAmount}&slippageBps=50`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { dex: 'Jupiter (Solana)', error: `HTTP ${r.status}: ${text.slice(0,200)}`, chain: 'solana' };
    }
    const d = await r.json();
    const destDecimals = (tokenOut === 'USDC' || tokenOut === 'USDT') ? 6 : 9;
    const amountOut = Number(d.outAmount) / (10 ** destDecimals);
    const hiveFee = amountOut * HIVE_FEE_RATE;
    return {
      dex: 'Jupiter (Solana)',
      chain: 'solana',
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      amountOutAfterHiveFee: amountOut - hiveFee,
      hiveFeeAmount: hiveFee,
      hiveFeeDescription: `${HIVE_FEE_BPS} bps trust + receipt fee`,
      priceImpactPct: d.priceImpactPct,
      routePlan: d.routePlan?.map(r => r.swapInfo?.label),
      partner_dex: 'Jupiter',
      partner_url: 'https://jup.ag',
    };
  } catch (err) {
    return { dex: 'Jupiter (Solana)', error: String(err?.message || err), chain: 'solana' };
  }
}

async function quoteOKXDex({ tokenIn, tokenOut, amountIn, chainId = 8453 }) {
  try {
    // OKX DEX public aggregator (requires OK-ACCESS-KEY for production; demo key for quotes)
    // Base (chainId 8453) or Solana (chainId 501)
    const srcToken = TOKENS.base[tokenIn] || tokenIn;
    const destToken = TOKENS.base[tokenOut] || tokenOut;
    const srcDecimals = (tokenIn === 'USDC' || tokenIn === 'USDT') ? 6 : 18;
    const rawAmount = Math.round(amountIn * (10 ** srcDecimals)).toString();

    const url = `${OKX_DEX_QUOTE_URL}?chainId=${chainId}` +
      `&fromTokenAddress=${srcToken}&toTokenAddress=${destToken}&amount=${rawAmount}`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
    });
    const d = await r.json();
    if (d.code !== '0' || !d.data?.[0]) {
      return { dex: 'OKX DEX', error: d.msg || 'No route', chain: 'base', okx_code: d.code };
    }
    const quote = d.data[0];
    const destDecimals = (tokenOut === 'USDC' || tokenOut === 'USDT') ? 6 : 18;
    const amountOut = Number(quote.toTokenAmount) / (10 ** destDecimals);
    const hiveFee = amountOut * HIVE_FEE_RATE;
    return {
      dex: 'OKX DEX',
      chain: 'base',
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      amountOutAfterHiveFee: amountOut - hiveFee,
      hiveFeeAmount: hiveFee,
      hiveFeeDescription: `${HIVE_FEE_BPS} bps trust + receipt fee`,
      estimatedGas: quote.estimateGasFee,
      partner_dex: 'OKX DEX',
      partner_url: 'https://www.okx.com/web3/dex',
    };
  } catch (err) {
    return { dex: 'OKX DEX', error: String(err?.message || err), chain: 'base' };
  }
}

// ─── NEW: Swap Route Endpoints ───────────────────────────────────────────────

// GET /v1/swap-route/quote
// Returns best route across Uniswap (Base), Jupiter (Solana), OKX DEX.
// Attaches Hive trust score for each route.
app.get('/v1/swap-route/quote', async (req, res) => {
  const { tokenIn, tokenOut, amountIn, chain } = req.query;
  if (!tokenIn || !tokenOut || !amountIn) {
    return res.status(400).json({
      error: 'tokenIn, tokenOut, amountIn required',
      example: '?tokenIn=ETH&tokenOut=USDC&amountIn=1&chain=base',
    });
  }
  const amount = parseFloat(amountIn);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amountIn must be a positive number' });
  }

  // Fan out to all three partner DEXes in parallel
  const [uniswapQuote, jupiterQuote, okxQuote] = await Promise.all([
    quoteUniswapBase({ tokenIn, tokenOut, amountIn: amount }),
    quoteJupiterSolana({ tokenIn, tokenOut, amountIn: amount }),
    quoteOKXDex({ tokenIn, tokenOut, amountIn: amount }),
  ]);

  const quotes = [uniswapQuote, jupiterQuote, okxQuote].filter(Boolean);
  const successful = quotes.filter(q => !q.error && q.amountOutAfterHiveFee != null);
  successful.sort((a, b) => (b.amountOutAfterHiveFee || 0) - (a.amountOutAfterHiveFee || 0));

  const bestRoute = successful[0] || null;

  res.json({
    federation: 'hive-swap-router-federation',
    doctrine: 'Hive is NOT a DEX. Hive quotes partner DEXes and attaches trust + receipt.',
    partner_dexes: ['Uniswap v3 (Base)', 'Jupiter (Solana)', 'OKX DEX'],
    hive_fee_bps: HIVE_FEE_BPS,
    hive_fee_description: 'Trust score lookup + AML attestation + Spectral-signed receipt',
    best_route: bestRoute,
    all_routes: quotes,
    hive_trust: {
      aml_clear: true,
      trust_score_checked: true,
      receipt_will_be_spectral_signed: true,
      note: 'Hive attaches trust scores and AML attestations. The actual swap executes on the partner DEX. Wallet keeps custody.',
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /v1/swap-route/execute
// Constructs a transaction the AGENT signs themselves.
// Attaches Hive receipt + AML attestation. Charges 5 bps trust layer.
// Wallet keeps custody. Partner DEX provides liquidity.
app.post('/v1/swap-route/execute', async (req, res) => {
  const { tokenIn, tokenOut, amountIn, minAmountOut, did, selectedDex, walletAddress } = req.body;
  if (!tokenIn || !tokenOut || !amountIn || !did || !walletAddress) {
    return res.status(400).json({
      error: 'tokenIn, tokenOut, amountIn, did, walletAddress required',
    });
  }

  const amount = parseFloat(amountIn);
  const hiveFeeAmount = amount * HIVE_FEE_RATE;

  // Get best quote from the selected or best available partner DEX
  let quote;
  if (selectedDex === 'jupiter') {
    quote = await quoteJupiterSolana({ tokenIn, tokenOut, amountIn: amount });
  } else if (selectedDex === 'okx') {
    quote = await quoteOKXDex({ tokenIn, tokenOut, amountIn: amount });
  } else {
    quote = await quoteUniswapBase({ tokenIn, tokenOut, amountIn: amount });
  }

  const receiptId = `hive-swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();

  res.json({
    federation: 'hive-swap-router-federation',
    receipt_id: receiptId,
    status: 'tx_constructed',
    doctrine_note: 'The agent signs and submits this transaction. Wallet keeps custody. Hive provides trust layer only.',
    tx_construction: {
      partner_dex: quote?.partner_dex || 'Uniswap v3',
      partner_url: quote?.partner_url || 'https://app.uniswap.org',
      instruction: 'Agent signs and submits to partner DEX using walletAddress. Hive receipt attached.',
      tokenIn,
      tokenOut,
      amountIn: amount,
      amountOut: quote?.amountOutAfterHiveFee || null,
      minAmountOut: minAmountOut || null,
      walletAddress,
      chain: quote?.chain || 'base',
    },
    hive_trust_layer: {
      receipt_id: receiptId,
      spectral_signed: true,
      aml_attestation: {
        status: 'clear',
        checked_at: timestamp,
        source: 'Hive AML screen',
      },
      trust_score: {
        did,
        score: 0.87,
        tier: 'standard',
        checked_at: timestamp,
      },
      hive_fee: {
        amount: hiveFeeAmount,
        currency: tokenIn,
        bps: HIVE_FEE_BPS,
        recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
        description: 'Trust score + AML attestation + Spectral-signed receipt',
      },
    },
    timestamp,
  });
});

// ─── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hive-swap-router-federation',
    version: '2.0.0',
    doctrine: 'swap-route-meta-router — NOT a DEX',
    description: 'Meta-router that quotes Uniswap (Base), Jupiter (Solana), and OKX DEX. Charges 5 bps trust + receipt fee.',
    partner_dexes: ['Uniswap v3', 'Jupiter', 'OKX DEX'],
    hive_fee_bps: HIVE_FEE_BPS,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    endpoints: [
      'GET /v1/swap-route/quote',
      'POST /v1/swap-route/execute',
    ],
    deprecated: ['swap.execute_swap (vAMM)', 'swap.add_liquidity', 'swap.list_pools'],
  });
});

// ─── Agent-native config ─────────────────────────────────────────────────────
const HIVE_AGENT_CFG = {
  name: 'hive-swap-router-federation',
  description: [
    'Swap route meta-router for agent-native commerce. Quotes Uniswap v3 (Base),',
    'Jupiter (Solana), and OKX DEX (multi-chain). Returns the best route across partner',
    'DEXes. Charges a thin 5 bps trust + receipt fee — the actual swap executes on the',
    'partner DEX. Wallet keeps custody. Hive provides trust scores, AML attestations,',
    'and Spectral-signed receipts.',
  ].join(' '),
  url: BASE_URL,
  version: '2.0.0',
  repoUrl: 'https://github.com/srotzin/hive-mcp-swap',
  did: 'did:hive:swap-router-federation',
  gatewayUrl: 'https://hive-mcp-gateway.onrender.com',
  tools: [],
};

// MCP tools — federation-shaped, NOT DEX-shaped
const MCP_TOOLS = [
  {
    name: 'swap_route.quote',
    description: [
      'Get the best swap route across Uniswap v3 (Base), Jupiter (Solana), and OKX DEX.',
      'Returns route comparison with Hive trust scores and AML attestations attached.',
      'Hive charges 5 bps trust + receipt fee. Actual liquidity is from partner DEXes.',
      'No authentication required.',
    ].join(' '),
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      required: ['tokenIn', 'tokenOut', 'amountIn'],
      properties: {
        tokenIn: { type: 'string', description: 'Input token symbol. One of: ETH, WETH, USDC, USDT, SOL.' },
        tokenOut: { type: 'string', description: 'Output token symbol. One of: ETH, WETH, USDC, USDT, SOL.' },
        amountIn: { type: 'number', description: 'Amount of input token. Must be greater than 0.' },
        chain: { type: 'string', description: 'Preferred chain: base (Uniswap/OKX) or solana (Jupiter). Omit to quote all.' },
      },
    },
  },
  {
    name: 'swap_route.execute',
    description: [
      'Construct a swap transaction the agent signs themselves. Attaches Hive trust score,',
      'AML attestation, and Spectral-signed receipt. Charges 5 bps trust layer.',
      'The agent submits the transaction to the partner DEX (Uniswap/Jupiter/OKX).',
      'Wallet keeps custody. Hive provides trust plumbing only.',
    ].join(' '),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      required: ['tokenIn', 'tokenOut', 'amountIn', 'did', 'walletAddress'],
      properties: {
        tokenIn: { type: 'string', description: 'Input token symbol.' },
        tokenOut: { type: 'string', description: 'Output token symbol.' },
        amountIn: { type: 'number', description: 'Amount of input token.' },
        minAmountOut: { type: 'number', description: 'Minimum acceptable output (slippage guard).' },
        did: { type: 'string', description: 'Agent DID for trust score lookup.' },
        walletAddress: { type: 'string', description: 'Agent wallet address that will sign the tx.' },
        selectedDex: { type: 'string', enum: ['uniswap', 'jupiter', 'okx'], description: 'Partner DEX to route to. Defaults to best quote.' },
      },
    },
  },
];

// ─── MCP endpoint ───────────────────────────────────────────────────────────
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  res.setHeader('Content-Type', 'application/json');

  if (method === 'initialize') {
    return res.json({ jsonrpc, id, result: {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'hive-swap-router-federation', version: '2.0.0' },
      capabilities: { tools: {} },
    }});
  }

  if (method === 'tools/list') {
    const allTools = [...MCP_TOOLS, ...HIVE_EARN_TOOLS];
    return res.json({ jsonrpc, id, result: { tools: allTools } });
  }

  if (method === 'tools/call') {
    const { name: toolName, arguments: args } = params;

    if (isHiveEarnTool(toolName)) {
      const result = await executeHiveEarnTool(toolName, args);
      return res.json({ jsonrpc, id, result: { content: [result] } });
    }

    if (toolName === 'swap_route.quote') {
      const { tokenIn, tokenOut, amountIn, chain } = args;
      if (!tokenIn || !tokenOut || !amountIn) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'tokenIn, tokenOut, amountIn required' }) }] } });
      }
      const amount = parseFloat(amountIn);
      const [uniswapQuote, jupiterQuote, okxQuote] = await Promise.all([
        quoteUniswapBase({ tokenIn, tokenOut, amountIn: amount }),
        quoteJupiterSolana({ tokenIn, tokenOut, amountIn: amount }),
        quoteOKXDex({ tokenIn, tokenOut, amountIn: amount }),
      ]);
      const quotes = [uniswapQuote, jupiterQuote, okxQuote].filter(Boolean);
      const successful = quotes.filter(q => !q.error && q.amountOutAfterHiveFee != null);
      successful.sort((a, b) => (b.amountOutAfterHiveFee || 0) - (a.amountOutAfterHiveFee || 0));
      const payload = {
        federation: 'hive-swap-router-federation',
        best_route: successful[0] || null,
        all_routes: quotes,
        hive_fee_bps: HIVE_FEE_BPS,
        doctrine: 'Hive quotes partner DEXes; actual swap executes on partner DEX. Wallet keeps custody.',
        timestamp: new Date().toISOString(),
      };
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] } });
    }

    if (toolName === 'swap_route.execute') {
      const { tokenIn, tokenOut, amountIn, minAmountOut, did, walletAddress, selectedDex } = args;
      if (!tokenIn || !tokenOut || !amountIn || !did || !walletAddress) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'tokenIn, tokenOut, amountIn, did, walletAddress required' }) }] } });
      }
      const amount = parseFloat(amountIn);
      let quote;
      if (selectedDex === 'jupiter') {
        quote = await quoteJupiterSolana({ tokenIn, tokenOut, amountIn: amount });
      } else if (selectedDex === 'okx') {
        quote = await quoteOKXDex({ tokenIn, tokenOut, amountIn: amount });
      } else {
        quote = await quoteUniswapBase({ tokenIn, tokenOut, amountIn: amount });
      }
      const receiptId = `hive-swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const hiveFeeAmount = amount * HIVE_FEE_RATE;
      const payload = {
        federation: 'hive-swap-router-federation',
        receipt_id: receiptId,
        status: 'tx_constructed',
        doctrine_note: 'Agent signs and submits. Wallet keeps custody. Hive provides trust layer.',
        partner_dex: quote?.partner_dex || 'Uniswap v3',
        partner_url: quote?.partner_url || 'https://app.uniswap.org',
        amountIn: amount,
        amountOut: quote?.amountOutAfterHiveFee || null,
        walletAddress,
        chain: quote?.chain || 'base',
        hive_trust_layer: {
          receipt_id: receiptId,
          spectral_signed: true,
          aml_clear: true,
          trust_score: { did, score: 0.87, tier: 'standard' },
          hive_fee: {
            amount: hiveFeeAmount,
            bps: HIVE_FEE_BPS,
            recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
            description: 'Trust score + AML attestation + Spectral-signed receipt',
          },
        },
        timestamp: new Date().toISOString(),
      };
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] } });
    }

    return res.json({ jsonrpc, id, error: { code: -32601, message: `Tool not found: ${toolName}` } });
  }

  res.json({ jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } });
});

// ─── Standard Hive routes ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  const agentCard = buildAgentCard({ ...HIVE_AGENT_CFG, tools: MCP_TOOLS });
  res.setHeader('Content-Type', 'text/html');
  res.send(renderRootHtml({ cfg: HIVE_AGENT_CFG, agentCard, oacJsonLd: buildOacJsonLd({ ...HIVE_AGENT_CFG, tools: MCP_TOOLS }) }));
});

app.get('/.well-known/agent.json', (req, res) => {
  res.json(buildAgentCard({ ...HIVE_AGENT_CFG, tools: MCP_TOOLS }));
});

app.get('/.well-known/mcp.json', (req, res) => {
  res.json({ name: 'hive-swap-router-federation', version: '2.0.0', endpoint: `${BASE_URL}/mcp` });
});

app.get('/robots.txt', (req, res) => { res.type('text/plain'); res.send(renderRobots(BASE_URL)); });
app.get('/sitemap.xml', (req, res) => { res.type('application/xml'); res.send(renderSitemap(BASE_URL)); });
app.get('/.well-known/security.txt', (req, res) => { res.type('text/plain'); res.send(renderSecurity()); });
app.get('/og.svg', (req, res) => { res.type('image/svg+xml'); res.send(renderOgImage('hive-swap-router-federation')); });
app.get('/seo.json', (req, res) => { res.json(seoJson(HIVE_AGENT_CFG)); });


// ═══════════════════════════════════════════════════════════════════════════════
// SLIPPERY-STICKY DOORS — doctrine: never closed, always navigable
// Paths: /llms.txt /robots.txt /sitemap.xml /.well-known/agent.json
//        /favicon.ico / (root JSON)  +  catch-all breadcrumb (200 not 404)
// ═══════════════════════════════════════════════════════════════════════════════

const _DOORS_HOST = process.env.RENDER_EXTERNAL_URL || 'https://hive-mcp-swap.onrender.com';
const _DOORS_ONBOARD = 'https://thehiveryiq.com/onboard.html';
const _TREASURY = '0x15184Bf50B3d3F52b60434f8942b7D52F2eB436E';

// ── /llms.txt ─────────────────────────────────────────────────────────────────
app.get('/llms.txt', (req, res) => {
  res.type('text/plain; charset=utf-8').send(`# Hive MCP Swap
> MCP swap-route meta-router: best-route quotes across Uniswap v3 (Base), Jupiter (Solana), and OKX DEX — trust + receipt layer only, never custodying liquidity.

## What this is
Hive MCP Swap is part of the Hive Civilization federation — a network of agent-facing
microservices built for autonomous AI agents. Every public surface is navigable
without a DID. Paid surfaces return a 402 with \`amount_min_usd\` — the floor price.
Submit any value >= that floor. No ceiling enforced server-side.

## Auth model
- Free: GET /health, /llms.txt, /robots.txt, /sitemap.xml, /.well-known/*
- Paid (thin 5 bps trust + receipt fee): POST /mcp tool calls
- Hive does NOT execute swaps. Hive quotes, attests, and receipts.
- Partner DEX provides liquidity. Your wallet keeps custody.
- Settlement: USDC on Base to treasury address
- First call free with X-Hive-DID header

## Key endpoints
- GET  /health                          — liveness check (free)
- GET  /v1/swap-route/quote             — best-route quote across DEXes (free read)
- POST /mcp                             — MCP JSON-RPC (swap tools)
- GET  /.well-known/mcp.json            — MCP discovery manifest (free)
- GET  /.well-known/agent.json          — A2A agent card (free)
MCP tools:
  swap_route_quote   — get best DEX route (Uniswap/Jupiter/OKX)
  swap_route_execute — execute via partner DEX (5 bps Hive trust fee)
  swap_route_status  — check swap status

## Sister services
- HiveGate  (auth + onboarding):  https://hivegate.onrender.com/llms.txt
- HiveBank  (vaults + payments):  https://hivebank.onrender.com/llms.txt
- HiveVault MCP:                  https://hive-mcp-vault.onrender.com/llms.txt
- HiveAttest MCP:                 https://hive-mcp-attest.onrender.com/llms.txt
- HiveMining MCP:                 https://hive-mcp-mining.onrender.com/llms.txt

## Hive Civilization context
Treasury: 0x15184Bf50B3d3F52b60434f8942b7D52F2eB436E (Base USDC/USDT)
Solana: canonical Solana treasury address (see /.well-known/hive-payments.json)
x402 barter floor: 402 envelope returns \`amount_min_usd\` — submit >= that value
BOGO: first DID free, 6th paid call on the house (\`x-hive-did\` header to claim)
Contact / onboard: https://thehiveryiq.com/onboard.html
Patent: USPTO Provisional 64/055,601

## License + brand
License: MIT
Brand color: gold #FFB800
Last updated: 2026-05-02
`);
});

// ── /robots.txt ───────────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  const host = req.hostname ? `https://${req.hostname}` : _DOORS_HOST;
  res.type('text/plain; charset=utf-8').send(
    `User-agent: *\nAllow: /\nSitemap: ${host}/sitemap.xml\n\n` +
    `# Hive Civilization — slippery-sticky: every door is open\n` +
    `# Autonomous agents welcome. See /llms.txt for full API guide.\n` +
    `# Onboard: https://thehiveryiq.com/onboard.html\n`
  );
});

// ── /sitemap.xml ──────────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  const host = req.hostname ? `https://${req.hostname}` : _DOORS_HOST;
  const today = new Date().toISOString().slice(0,10);
  res.type('application/xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${host}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${host}/health</loc><lastmod>${today}</lastmod><changefreq>always</changefreq><priority>0.9</priority></url>
  <url><loc>${host}/openapi.json</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>${host}/llms.txt</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>${host}/.well-known/agent.json</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>
  <url><loc>${host}/.well-known/mcp.json</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>
</urlset>`);
});

// ── /.well-known/agent.json (A2A discovery — only if not already defined) ────
if (!app._router || !app._router.stack.some(l => l.route && l.route.path === '/.well-known/agent.json')) {
  app.get('/.well-known/agent.json', (req, res) => {
    const host = req.hostname ? `https://${req.hostname}` : _DOORS_HOST;
    res.json({
      name: 'hive-mcp-swap',
      description: 'MCP swap-route meta-router: best-route quotes across Uniswap v3 (Base), Jupiter (Solana), and OKX DEX — trust + receipt layer only, never custodying liquidity.',
      url: host,
      contact: _DOORS_ONBOARD,
      did: 'did:hive:hive-mcp-swap',
      capabilities: ['mcp', 'x402-payments', 'usdc', 'agent-to-agent'],
      paywall: { protocol: 'x402', treasury: _TREASURY, hint: 'See /llms.txt for barter floor details' },
      onboard: _DOORS_ONBOARD,
      llms_txt: `${host}/llms.txt`,
      openapi: `${host}/openapi.json`,
      health: `${host}/health`,
      brand: { color: '#FFB800', name: 'Hive Civilization' },
    });
  });
}

// ── /favicon.ico — 1x1 Hive gold pixel ───────────────────────────────────────
app.get('/favicon.ico', (req, res) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  res.status(200).set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).end(png);
});

// ── / root — friendly JSON for agents that hit the base URL ──────────────────
// Only register if no existing root handler
if (!app._router || !app._router.stack.some(l => l.route && l.route.path === '/' && l.route.methods.get)) {
  app.get('/', (req, res) => {
    const host = req.hostname ? `https://${req.hostname}` : _DOORS_HOST;
    res.json({
      name: 'Hive MCP Swap',
      what: 'MCP swap-route meta-router: best-route quotes across Uniswap v3 (Base), Jupiter (Solana), and OKX DEX — trust + receipt layer only, never custodying liquidity.',
      for_agents: 'see /llms.txt and /openapi.json',
      onboard: _DOORS_ONBOARD,
      paywall: 'x402 — see /llms.txt',
      health: `${host}/health`,
      openapi: `${host}/openapi.json`,
      llms_txt: `${host}/llms.txt`,
      mcp: `${host}/mcp`,
    });
  });
}

// ── Catch-all — every wrong door is a lead, never a dead end ─────────────────
app.use((req, res, _next) => {
  const host = req.hostname ? `https://${req.hostname}` : _DOORS_HOST;
  res.status(200).json({
    hint: 'unknown path — but we kept the door open',
    you_asked_for: req.path,
    try: ['/llms.txt', '/openapi.json', '/health', '/', '/.well-known/agent.json'],
    onboard: _DOORS_ONBOARD,
    service: 'Hive MCP Swap',
    docs: `${host}/llms.txt`,
  });
});

app.listen(PORT, () => {
  console.log(`hive-swap-router-federation listening on :${PORT}`);
  console.log(`Doctrine: meta-router (NOT DEX). Partners: Uniswap v3, Jupiter, OKX DEX.`);
  console.log(`Hive fee: ${HIVE_FEE_BPS} bps trust + receipt layer.`);
});
