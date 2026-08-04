// server.js: hive-swap-router-federation MCP Server
// This is a read-only Paraswap quote adapter for Base, not a DEX. Hive does
// not construct transactions, execute swaps, collect fees, or custody funds.
//
// There is no trust score service, no AML attestation service, and no
// Spectral signing service behind this server today. Do not add fields that
// claim those checks happened until a real service backs them.
//
// Brand: Hive Civilization gold #C08D23 (never #f5c518).

import express from 'express';
import { smashProvMiddleware, getPubkeyInfo as getProvPubkeyInfo, verifyProvSig } from './lib/prov.js';
import { buildAgentCard, buildOacJsonLd, renderOgImageSvg, renderRootHtml } from './hive-agent-card.js';
import cors from 'cors';
import { renderSecurity } from './meta.js';

// Environment validation
// Fail fast and loudly if required configuration is missing or malformed.
// This server signs every response with an Ed25519 key (see lib/prov.js) and
// signs discovery responses. If that configuration is wrong, every signed
// response would be wrong too, so we refuse to boot instead of serving it.
function validateEnv() {
  const errors = [];

  if (process.env.PORT != null && process.env.PORT !== '') {
    const p = Number(process.env.PORT);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) {
      errors.push(`PORT must be an integer between 1 and 65535, got: ${process.env.PORT}`);
    }
  }

  if (process.env.BASE_URL != null && process.env.BASE_URL !== '') {
    try { new URL(process.env.BASE_URL); }
    catch { errors.push(`BASE_URL is not a valid URL: ${process.env.BASE_URL}`); }
  }

  if (process.env.HIVE_PROV_SEED != null && process.env.HIVE_PROV_SEED !== '') {
    try {
      const decoded = Buffer.from(process.env.HIVE_PROV_SEED, 'base64url');
      if (decoded.length !== 32) {
        errors.push(`HIVE_PROV_SEED must decode to exactly 32 bytes (base64url), got ${decoded.length} bytes`);
      }
    } catch {
      errors.push('HIVE_PROV_SEED is not valid base64url');
    }
  }

  if (errors.length) {
    console.error('Environment validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

validateEnv();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://mcp-swap.thehiveryiq.com';

// Paraswap aggregator on Base mainnet. Price quotes require no API key.
const PARASWAP_BASE = 'https://apiv5.paraswap.io';
const PARASWAP_NETWORK_BASE = 8453;

// Well-known token addresses
const TOKENS = {
  base: {
    ETH:  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
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

async function quoteParaswapBase({ tokenIn, tokenOut, amountIn }) {
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
    const venues = route.bestRoute?.flatMap(path =>
      path.swaps?.flatMap(swap =>
        swap.swapExchanges?.map(exchange => ({
          exchange: exchange.exchange,
          percent: exchange.percent,
        })) || []
      ) || []
    ) || [];
    return {
      provider: 'Paraswap',
      network_id: PARASWAP_NETWORK_BASE,
      chain: 'base',
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: destAmount,
      fee_bps: 0,
      fee_collected: false,
      gasCostUSD: route.gasCostUSD,
      venues,
      provider_url: 'https://www.paraswap.io',
      raw_paraswap: { srcUSD: route.srcUSD, destUSD: route.destUSD },
    };
  } catch (err) {
    return { provider: 'Paraswap', error: String(err?.message || err), chain: 'base' };
  }
}

// Swap Route Endpoints

// GET /v1/swap-route/quote
// Returns a read-only price route from Paraswap on Base.
app.get('/v1/swap-route/quote', async (req, res) => {
  const { tokenIn, tokenOut, amountIn } = req.query;
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

  const quote = await quoteParaswapBase({ tokenIn, tokenOut, amountIn: amount });

  if (!quote || quote.error) {
    return res.status(502).json({
      error: 'no_route_available',
      message: 'Paraswap did not return a usable Base quote for this pair and amount.',
      upstream: quote || null,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    federation: 'hive-swap-router-federation',
    doctrine: 'Read-only Paraswap price quote on Base. Hive does not construct or submit a transaction and does not custody funds.',
    quote,
    timestamp: new Date().toISOString(),
  });
});

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hive-swap-router-federation',
    version: '2.2.0',
    doctrine: 'swap-route-meta-router, not a DEX',
    description: 'Read-only Paraswap price quotes on Base. No transaction construction, execution, custody, or fee collection.',
    quote_provider: 'Paraswap',
    chain: 'base',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    endpoints: [
      'GET /v1/swap-route/quote',
    ],
  });
});

// Agent-native config
const HIVE_AGENT_CFG = {
  name: 'hive-swap-router-federation',
  description: [
    'Read-only Paraswap price quotes on Base for agent-native commerce.',
    'Hive does not construct or submit transactions, collect a routing fee,',
    'operate liquidity, or custody funds.',
  ].join(' '),
  url: BASE_URL,
  version: '2.2.0',
  repoUrl: 'https://github.com/srotzin/hive-mcp-swap',
  did: 'did:hive:swap-router-federation',
  gatewayUrl: 'https://mcp-swap.thehiveryiq.com',
  tools: [],
};

// MCP tools, federation-shaped, not DEX-shaped
const MCP_TOOLS = [
  {
    name: 'swap_route.quote',
    description: [
      'Get a read-only Paraswap price quote on Base.',
      'The response identifies the actual venues returned by Paraswap.',
      'No transaction construction, execution, custody, or fee collection.',
    ].join(' '),
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      required: ['tokenIn', 'tokenOut', 'amountIn'],
      properties: {
        tokenIn: { type: 'string', description: 'Input token symbol on Base. One of: ETH, WETH, USDC, USDT.' },
        tokenOut: { type: 'string', description: 'Output token symbol on Base. One of: ETH, WETH, USDC, USDT.' },
        amountIn: { type: 'number', description: 'Amount of input token. Must be greater than 0.' },
      },
    },
  },
];

// MCP endpoint
// JSON-RPC 2.0 over Streamable-HTTP, MCP 2024-11-05. Any method this server
// does not implement returns a real JSON-RPC error, not a fabricated result.
app.post('/mcp', async (req, res) => {
  const body = req.body || {};
  const { jsonrpc, id, method, params } = body;
  res.setHeader('Content-Type', 'application/json');

  if (jsonrpc !== '2.0' || !method || typeof method !== 'string') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid Request: body must be JSON-RPC 2.0 with a string method.' },
    });
  }

  if (method === 'initialize') {
    return res.json({ jsonrpc, id, result: {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'hive-swap-router-federation', version: '2.2.0' },
      capabilities: { tools: {} },
    }});
  }

  if (method === 'tools/list') {
    return res.json({ jsonrpc, id, result: { tools: MCP_TOOLS } });
  }

  if (method === 'tools/call') {
    const { name: toolName, arguments: args = {} } = params || {};

    if (!toolName || typeof toolName !== 'string') {
      return res.json({ jsonrpc, id, error: { code: -32602, message: 'Invalid params: arguments.name is required.' } });
    }

    if (toolName === 'swap_route.quote') {
      const { tokenIn, tokenOut, amountIn } = args;
      if (!tokenIn || !tokenOut || !amountIn) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'tokenIn, tokenOut, amountIn required' }) }] } });
      }
      const amount = parseFloat(amountIn);
      if (isNaN(amount) || amount <= 0) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'amountIn must be a positive number' }) }] } });
      }
      const quote = await quoteParaswapBase({ tokenIn, tokenOut, amountIn: amount });
      const payload = quote && !quote.error
        ? {
            federation: 'hive-swap-router-federation',
            quote,
            doctrine: 'Read-only Paraswap price quote on Base. Hive does not construct or submit transactions.',
            timestamp: new Date().toISOString(),
          }
        : {
            error: 'no_route_available',
            message: 'Paraswap did not return a usable Base quote for this pair and amount.',
            upstream: quote || null,
          };
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] } });
    }

    return res.json({ jsonrpc, id, error: { code: -32601, message: `Tool not found: ${toolName}` } });
  }

  res.json({ jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } });
});

// Standard Hive routes
// Each path below is registered exactly once. There is no duplicate
// registration and no catch-all that returns 200 for a path that does not
// exist. Unknown paths get a real 404 (see the bottom of this file).

const _HOST_DEFAULT = process.env.RENDER_EXTERNAL_URL || BASE_URL;
const _ONBOARD_URL = 'https://thehiveryiq.com/onboard.html';

function hostFor(req) {
  return req.hostname ? `https://${req.hostname}` : _HOST_DEFAULT;
}

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(renderRootHtml({ ...HIVE_AGENT_CFG, tools: MCP_TOOLS }));
});

app.get('/.well-known/agent.json', (req, res) => {
  res.json(buildAgentCard({ ...HIVE_AGENT_CFG, tools: MCP_TOOLS }));
});

app.get('/.well-known/mcp.json', (req, res) => {
  res.json({ name: 'hive-swap-router-federation', version: '2.2.0', endpoint: `${BASE_URL}/mcp` });
});

app.get('/.well-known/security.txt', (req, res) => { res.type('text/plain'); res.send(renderSecurity()); });
app.get('/og.svg', (req, res) => {
  res.type('image/svg+xml');
  res.send(renderOgImageSvg(HIVE_AGENT_CFG));
});

app.get('/llms.txt', (req, res) => {
  const host = hostFor(req);
  res.type('text/plain; charset=utf-8').send(`# Hive MCP Swap
> Read-only Paraswap price quotes on Base. Hive does not construct or submit transactions, collect fees, or custody funds.

## What this is
Hive MCP Swap is part of the Hive Civilization federation, a network of agent-facing
microservices built for autonomous AI agents. Every real endpoint is documented below.
Paths that are not listed here do not exist on this server and return a 404.

## Auth model
- Free: GET /health, /llms.txt, /robots.txt, /sitemap.xml, /.well-known/*
- Free: quote calls under /v1/swap-route and /mcp
- Hive does not construct or submit transactions.

## Key endpoints
- GET  /health                     liveness check (free)
- GET  /v1/swap-route/quote        read-only Paraswap quote on Base
- POST /mcp                        MCP JSON-RPC (swap_route.quote)
- GET  /.well-known/mcp.json       MCP discovery manifest (free)
- GET  /.well-known/agent.json     A2A agent card (free)

## Scope
- The server returns price information only.
- It does not construct, sign, submit, or settle transactions.

## Contact
Onboard: https://thehiveryiq.com/onboard.html

## License and brand
License: MIT
Brand color: gold #C08D23
`);
});

app.get('/robots.txt', (req, res) => {
  const host = hostFor(req);
  res.type('text/plain; charset=utf-8').send(
    `User-agent: *\nAllow: /\nSitemap: ${host}/sitemap.xml\n\n` +
    `# Hive Civilization public discovery surface. Autonomous agents welcome.\n` +
    `# See /llms.txt for the full API guide.\n` +
    `# Onboard: https://thehiveryiq.com/onboard.html\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const host = hostFor(req);
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${host}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${host}/health</loc><lastmod>${today}</lastmod><changefreq>always</changefreq><priority>0.9</priority></url>
  <url><loc>${host}/llms.txt</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>${host}/.well-known/agent.json</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>
  <url><loc>${host}/.well-known/mcp.json</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>
</urlset>`);
});

// /favicon.ico, a 1x1 Hive gold pixel
app.get('/favicon.ico', (req, res) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  res.status(200).set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).end(png);
});

// Unknown routes fail honestly
// This server does not pretend an unknown path is a valid endpoint. A request
// to any path not registered above returns a real 404 with a list of the
// endpoints that do exist, so a client can recover without being told a lie.
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `No route for ${req.method} ${req.path}.`,
    known_endpoints: [
      'GET /',
      'GET /health',
      'GET /llms.txt',
      'GET /robots.txt',
      'GET /sitemap.xml',
      'GET /.well-known/agent.json',
      'GET /.well-known/mcp.json',
      'GET /.well-known/security.txt',
      'GET /v1/swap-route/quote',
      'POST /mcp',
    ],
    onboard: _ONBOARD_URL,
  });
});

// Error handler
// Any uncaught error in a route handler fails honestly with a 500 instead of
// crashing silently or being swallowed into a fake 200.
app.use((err, req, res, _next) => {
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  if (res.headersSent) return;
  res.status(500).json({
    error: 'internal_error',
    message: 'The server hit an unexpected error handling this request.',
  });
});

// Only bind a port when this file is run directly (`node server.js`).
// When imported as a module, e.g. from tests via supertest, exporting the
// app without listening avoids port conflicts and lets tests control
// the lifecycle.
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`hive-swap-router-federation listening on :${PORT}`);
    console.log('Doctrine: read-only Paraswap price quotes on Base. Not a DEX.');
  });
}

export default app;
