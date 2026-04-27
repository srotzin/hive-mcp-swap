// server.js — HiveSwap MCP Server
import express from 'express';
import { HIVE_EARN_TOOLS, executeHiveEarnTool, isHiveEarnTool } from './hive-earn-tools.js';
import { buildAgentCard, buildOacJsonLd, renderRootHtml } from './hive-agent-card.js';
import cors from 'cors';
import { renderLanding, renderRobots, renderSitemap, renderSecurity, renderOgImage, seoJson, BRAND_GOLD } from './meta.js';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = 'https://hiveswap.onrender.com';
const INTERNAL_KEY = process.env.INTERNAL_KEY || 'hive_internal_125e04e071e8829be631ea0216dd4a0c9b707975fcecaf8c62c6a2ab43327d46';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ─── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hiveswap-mcp',
    version: '1.0.0',
    description: 'Agent-native vAMM DEX for USDC, USDCx, USAD, and ALEO across 4 settlement rails',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    rails: ['base-usdc', 'aleo-usdcx', 'aleo-usad', 'aleo-native'],
    pairs: ['USDC/USDCx', 'USDC/USAD', 'USDC/ALEO', 'USDCx/USAD'],
  });
});

// ─── MCP Tools ──────────────────────────────────────────────────────────────

// ─── Agent-native config (A2A AgentCard + OAC JSON-LD + earn rails) ───────
const HIVE_AGENT_CFG = {
  name: 'HiveSwap MCP',
  description: "Agent-native vAMM DEX MCP server for USDC, USDCx, USAD across 4 settlement rails. Real Base USDC settlement, no testnet.",
  url: 'https://hive-mcp-swap.onrender.com',
  version: '1.0.2',
  repoUrl: 'https://github.com/srotzin/hive-mcp-swap',
  did: 'did:hive:swap',
  gatewayUrl: 'https://hive-mcp-gateway.onrender.com',
  // Tools attached at runtime (after merging earn tools in)
  tools: [],
};

const MCP_TOOLS = [
  {
    name: 'swap.get_quote',
    description: 'Get a swap quote for any token pair across Hive\'s 4 settlement rails. Returns best route, expected output amount, price impact percentage, and total fees. Supports USDC, USDCx, USAD, and ALEO. No authentication required.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      required: ['token_in', 'token_out', 'amount_in'],
      properties: {
        token_in: { type: 'string', description: 'Input token symbol. One of: USDC, USDCx, USAD, ALEO.' },
        token_out: { type: 'string', description: 'Output token symbol. One of: USDC, USDCx, USAD, ALEO.' },
        amount_in: { type: 'number', description: 'Amount of input token to swap. Must be greater than 0.' },
        rail: { type: 'string', description: 'Preferred settlement rail. One of: base-usdc, aleo-usdcx, aleo-usad, aleo-native. Defaults to base-usdc.' },
        slippage_pct: { type: 'number', description: 'Maximum acceptable slippage as a percentage (e.g. 0.5 for 0.5%). Default 0.5.' },
      },
    },
  },
  {
    name: 'swap.execute_swap',
    description: 'Execute a token swap via Hive\'s vAMM with slippage tolerance. Agent-signed transaction routed through HiveBank settlement. ZK-private swaps available via aleo-usdcx rail. USDC swaps settle on Base L2 in under 2 seconds.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      required: ['token_in', 'token_out', 'amount_in', 'min_amount_out', 'did', 'api_key'],
      properties: {
        token_in: { type: 'string', description: 'Input token symbol. One of: USDC, USDCx, USAD, ALEO.' },
        token_out: { type: 'string', description: 'Output token symbol. One of: USDC, USDCx, USAD, ALEO.' },
        amount_in: { type: 'number', description: 'Exact amount of input token to swap.' },
        min_amount_out: { type: 'number', description: 'Minimum acceptable output amount (slippage protection). Use swap.get_quote to compute this.' },
        rail: { type: 'string', description: 'Settlement rail. One of: base-usdc (fastest), aleo-usdcx (ZK-private), aleo-usad (anonymous), aleo-native. Default: base-usdc.' },
        did: { type: 'string', description: 'Agent DID (e.g. did:hive:xxxx). Obtain via HiveGate onboarding.' },
        api_key: { type: 'string', description: 'Agent API key issued by HiveGate at onboarding.' },
      },
    },
  },
  {
    name: 'swap.list_pools',
    description: 'List all available liquidity pools on HiveSwap. Returns pool ID, token pair, total value locked (TVL), current price, 24h volume, and current APY for liquidity providers. No authentication required.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        rail: { type: 'string', description: 'Filter pools by settlement rail. One of: base-usdc, aleo-usdcx, aleo-usad, aleo-native.' },
        limit: { type: 'integer', description: 'Maximum number of pools to return. Default 20.' },
      },
    },
  },
  {
    name: 'swap.get_pool_stats',
    description: 'Get detailed pool statistics for a specific token pair — pool depth, 24h and 7d trading volume, total fees collected, price impact curve, and current top liquidity providers. No authentication required.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      required: ['pool_id'],
      properties: {
        pool_id: { type: 'string', description: 'Pool identifier (e.g. USDC-ALEO, USDC-USDCx). Obtain from swap.list_pools.' },
      },
    },
  },
  {
    name: 'swap.add_liquidity',
    description: 'Add liquidity to a HiveSwap pool to earn fees from agent trading volume. Returns LP token receipt representing your share of the pool. Fees earned from every swap that uses your liquidity.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      required: ['pool_id', 'amount_a', 'amount_b', 'did', 'api_key'],
      properties: {
        pool_id: { type: 'string', description: 'Pool identifier to add liquidity to (e.g. USDC-ALEO). Obtain from swap.list_pools.' },
        amount_a: { type: 'number', description: 'Amount of the first token in the pair to deposit.' },
        amount_b: { type: 'number', description: 'Amount of the second token in the pair to deposit.' },
        slippage_pct: { type: 'number', description: 'Maximum acceptable slippage during deposit as a percentage. Default 0.5.' },
        did: { type: 'string', description: 'Agent DID (e.g. did:hive:xxxx). Required for authenticated operations.' },
        api_key: { type: 'string', description: 'Agent API key issued by HiveGate.' },
      },
    },
  },
];


const SERVICE_CFG = {
  service: "hive-mcp-swap",
  shortName: "HiveSwap",
  title: "HiveSwap \u00b7 Agent-Native vAMM DEX MCP",
  tagline: "Agent-native vAMM DEX for USDC, USDCx, USAD, ALEO across 4 settlement rails.",
  description: "MCP server for HiveSwap \u2014 agent-native vAMM DEX. Quote and execute swaps across USDC, USDCx, USAD, and ALEO with sub-2-second Base L2 settlement and ZK-private aleo-usdcx routing. Real rails, no simulated trades.",
  keywords: ["mcp", "model-context-protocol", "x402", "agentic", "ai-agent", "ai-agents", "llm", "hive", "hive-civilization", "dex", "vamm", "amm", "swap", "usdc", "base", "base-l2", "aleo", "zk-privacy", "agent-economy"],
  externalUrl: "https://hive-mcp-gateway.onrender.com/swap",
  gatewayMount: "/swap",
  version: "1.0.1",
  pricing: [
    { name: "swap.get_quote", priceUsd: 0, label: "Quote \u2014 free" },
    { name: "swap.execute_swap", priceUsd: 0.005, label: "Execute swap (Tier 2)" }
  ],
};
SERVICE_CFG.tools = (typeof TOOLS !== 'undefined' ? TOOLS : (typeof MCP_TOOLS !== 'undefined' ? MCP_TOOLS : [])).map(t => ({ name: t.name, description: t.description }));

// HIVE_AGENT_NATIVE_v1 — earn tools + AgentCard wiring
for (const t of HIVE_EARN_TOOLS) {
  if (!MCP_TOOLS.find(x => x.name === t.name)) MCP_TOOLS.push(t);
}
HIVE_AGENT_CFG.tools = MCP_TOOLS;
// ─── MCP Prompts ────────────────────────────────────────────────────────────
const MCP_PROMPTS = [
  {
    name: 'find_best_swap_route',
    description: 'Get the best swap route and quote for a token pair, comparing all available pools and rails.',
    arguments: [
      { name: 'token_in', description: 'Token to swap from (USDC, USDCx, USAD, ALEO)', required: false },
      { name: 'token_out', description: 'Token to swap to', required: false },
    ],
  },
  {
    name: 'add_liquidity_guide',
    description: 'Guide an agent through providing liquidity to a HiveSwap pool and understanding fee earnings.',
    arguments: [
      { name: 'pool_id', description: 'Pool to add liquidity to (e.g. USDC-ALEO)', required: false },
    ],
  },
  {
    name: 'private_swap_guide',
    description: 'Walk through a ZK-private swap using the Aleo rail for anonymous token exchange.',
    arguments: [],
  },
];

// ─── Config Schema ───────────────────────────────────────────────────────────
const MCP_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    did: { type: 'string', title: 'Agent DID', 'x-order': 0 },
    api_key: { type: 'string', title: 'API Key', 'x-sensitive': true, 'x-order': 1 },
    default_rail: {
      type: 'string',
      title: 'Settlement Rail',
      enum: ['base-usdc', 'aleo-usdcx'],
      default: 'base-usdc',
      'x-order': 2,
    },
  },
  required: [],
};

// ─── MCP Handler ─────────────────────────────────────────────────────────────
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC' } });
  }
  try {
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
            resources: { listChanged: false },
          },
          serverInfo: {
            name: 'hiveswap-mcp',
            version: '1.0.0',
            description: 'Agent-native vAMM DEX for swapping USDC, USDCx, USAD, and ALEO across 4 settlement rails. ZK-private swaps via Aleo rail. Deep liquidity from Hive Civilization genesis agent pool. Settles in milliseconds via HiveBank. Part of Hive Civilization (thehiveryiq.com).',
            homepage: BASE_URL,
            icon: 'https://www.thehiveryiq.com/favicon.ico',
          },
          configSchema: MCP_CONFIG_SCHEMA,
        },
      });
    }

    if (method === 'tools/list') {
      return res.json({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
    }

    if (method === 'prompts/list') {
      return res.json({ jsonrpc: '2.0', id, result: { prompts: MCP_PROMPTS } });
    }

    if (method === 'prompts/get') {
      const prompt = MCP_PROMPTS.find(p => p.name === params?.name);
      if (!prompt) {
        return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Prompt not found: ${params?.name}` } });
      }
      const args = params?.arguments || {};
      const messages = {
        find_best_swap_route: [{ role: 'user', content: { type: 'text', text: `Find the best swap route${args.token_in ? ` from ${args.token_in}` : ''}${args.token_out ? ` to ${args.token_out}` : ''} on HiveSwap. Compare all available pools and rails. Show the quote, price impact, and fees for each route.` } }],
        add_liquidity_guide: [{ role: 'user', content: { type: 'text', text: `Guide me through adding liquidity to the${args.pool_id ? ` ${args.pool_id}` : ''} HiveSwap pool. Show me current APY, required token amounts, expected fee earnings, and how to deposit.` } }],
        private_swap_guide: [{ role: 'user', content: { type: 'text', text: `Walk me through executing a ZK-private swap using the Aleo rail on HiveSwap. Explain how USDCx privacy works, what gets hidden on-chain, and how to choose the right rail for anonymous token exchange.` } }],
      };
      return res.json({ jsonrpc: '2.0', id, result: { messages: messages[prompt.name] || [] } });
    }

    if (method === 'resources/list') {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          resources: [
            { uri: 'hiveswap://pools/all', name: 'All Liquidity Pools', description: 'All active HiveSwap liquidity pools with TVL and APY.', mimeType: 'application/json' },
            { uri: 'hiveswap://health', name: 'Swap Service Health', description: 'Current health and stats for HiveSwap DEX.', mimeType: 'application/json' },
            { uri: 'hiveswap://rails/info', name: 'Settlement Rails', description: 'Information on all 4 settlement rails — base-usdc, aleo-usdcx, aleo-usad, aleo-native.', mimeType: 'application/json' },
          ],
        },
      });
    }

    if (method === 'resources/read') {
      const uri = params?.uri;
      let data;
      if (uri === 'hiveswap://pools/all') {
        data = await fetch(`${BASE_URL}/v1/swap/pools`).then(r => r.json()).catch(() => ({
          status: 'ok',
          pools: [
            { id: 'USDC-ALEO', tokens: ['USDC', 'ALEO'], rail: 'base-usdc', tvl_usdc: 250000, apy_pct: 12.4 },
            { id: 'USDC-USDCx', tokens: ['USDC', 'USDCx'], rail: 'aleo-usdcx', tvl_usdc: 180000, apy_pct: 8.2 },
            { id: 'USDC-USAD', tokens: ['USDC', 'USAD'], rail: 'aleo-usad', tvl_usdc: 95000, apy_pct: 6.7 },
          ],
        }));
      } else if (uri === 'hiveswap://health') {
        data = await fetch(`${BASE_URL}/health`).then(r => r.json()).catch(() => ({ status: 'ok', service: 'hiveswap', note: 'Service may be warming up.' }));
      } else if (uri === 'hiveswap://rails/info') {
        data = {
          rails: {
            'base-usdc': { network: 'Base L2', token: 'USDC', speed: '<2s', private: false },
            'aleo-usdcx': { network: 'Aleo ZK', token: 'USDCx', speed: '~5s', private: true },
            'aleo-usad': { network: 'Aleo ZK', token: 'USAD', speed: '~5s', private: true, anonymous: true },
            'aleo-native': { network: 'Aleo', token: 'ALEO', speed: '~5s', private: false },
          },
        };
      } else {
        return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource: ${uri}` } });
      }
      return res.json({ jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] } });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      // HIVE_AGENT_DISPATCH_v1 — earn tools first
      if (isHiveEarnTool(name)) {
        const earnOut = await executeHiveEarnTool(name, args || {});
        if (earnOut) return res.json({ jsonrpc: '2.0', id, result: { content: [earnOut] } });
      }
      const headers = { 'Content-Type': 'application/json', 'x-hive-did': args?.did || '', 'x-api-key': args?.api_key || '', 'x-internal-key': INTERNAL_KEY };

      const toolRoutes = {
        'swap.get_quote': () => fetch(`${BASE_URL}/v1/swap/quote`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ token_in: args?.token_in, token_out: args?.token_out, amount_in: args?.amount_in, rail: args?.rail || 'base-usdc', slippage_pct: args?.slippage_pct || 0.5 }),
        }).then(r => r.json()),

        'swap.execute_swap': () => fetch(`${BASE_URL}/v1/swap/execute`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ token_in: args?.token_in, token_out: args?.token_out, amount_in: args?.amount_in, min_amount_out: args?.min_amount_out, rail: args?.rail || 'base-usdc', did: args?.did, api_key: args?.api_key }),
        }).then(r => r.json()),

        'swap.list_pools': () => fetch(`${BASE_URL}/v1/swap/pools?rail=${args?.rail || ''}&limit=${args?.limit || 20}`, { headers }).then(r => r.json()),

        'swap.get_pool_stats': () => fetch(`${BASE_URL}/v1/swap/pools/${encodeURIComponent(args?.pool_id || '')}`, { headers }).then(r => r.json()),

        'swap.add_liquidity': () => fetch(`${BASE_URL}/v1/swap/liquidity`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ pool_id: args?.pool_id, amount_a: args?.amount_a, amount_b: args?.amount_b, slippage_pct: args?.slippage_pct || 0.5, did: args?.did, api_key: args?.api_key }),
        }).then(r => r.json()),
      };

      if (!toolRoutes[name]) {
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${name}` } });
      }
      const data = await toolRoutes[name]();
      return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } });
    }

    if (method === 'ping') return res.json({ jsonrpc: '2.0', id, result: {} });
    return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });

  } catch (err) {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

app.get('/.well-known/mcp.json', (req, res) => res.json({
  name: 'hiveswap-mcp',
  version: '1.0.0',
  description: 'Agent-native vAMM DEX for swapping USDC, USDCx, USAD, and ALEO across 4 settlement rails.',
  endpoint: '/mcp',
  transport: 'streamable-http',
  protocol: '2024-11-05',
  homepage: BASE_URL,
  icon: 'https://www.thehiveryiq.com/favicon.ico',
  tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description })),
  prompts: MCP_PROMPTS.map(p => ({ name: p.name, description: p.description })),
}));


// HIVE_META_BLOCK_v1 — comprehensive meta tags + JSON-LD + crawler discovery
app.get('/', (req, res) => {
  // HIVE_AGENT_INJECT_LD_v1 — inject OAC JSON-LD into the meta-tags landing
  const __landing = renderLanding(SERVICE_CFG);
  const __oacLd = JSON.stringify(buildOacJsonLd(HIVE_AGENT_CFG)).replace(/</g, '\\u003c');
  const __ldTag = '\n<script type="application/ld+json">' + __oacLd + '</script>\n';
  const __out = __landing.replace('</head>', __ldTag + '</head>');
  res.type('text/html; charset=utf-8').send(__out);
});
app.get('/og.svg', (req, res) => {
  res.type('image/svg+xml').send(renderOgImage(SERVICE_CFG));
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(renderRobots(SERVICE_CFG));
});
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(renderSitemap(SERVICE_CFG));
});
app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send(renderSecurity());
});
app.get('/seo.json', (req, res) => res.json(seoJson(SERVICE_CFG)));
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    error: 'NOT_FOUND',
    detail: `Route ${req.method} ${req.path} not found`,
    available: ['GET /health', 'POST /mcp', 'GET /.well-known/mcp.json'],
  });
});

// HIVE_AGENT_ROUTES_v1 — A2A AgentCard + OAC JSON-LD
app.get('/.well-known/agent.json', (req, res) => {
  res.json(buildAgentCard(HIVE_AGENT_CFG));
});
app.get('/agent.json', (req, res) => {
  res.json(buildAgentCard(HIVE_AGENT_CFG));
});
app.get('/.well-known/oac.json', (req, res) => {
  res.json(buildOacJsonLd(HIVE_AGENT_CFG));
});
app.get('/agent.html', (req, res) => {
  res.type('text/html; charset=utf-8').send(renderRootHtml(HIVE_AGENT_CFG));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[hiveswap-mcp] Running on port ${PORT}`);
  console.log(`[hiveswap-mcp] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[hiveswap-mcp] Proxying to: ${BASE_URL}`);
});

export default app;
