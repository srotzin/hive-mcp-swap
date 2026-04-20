// HiveSwap Backend — Express.js vAMM API v2
// Implements HiveCurve pricing per hiveswap-vamm-design.md
// Pairs: USDC/ALEO, USDC/USDCx, USDC/USAD, USDCx/USAD
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const HIVE_INTERNAL_KEY = process.env.HIVE_INTERNAL_KEY ||
  'hive_internal_125e04e071e8829be631ea0216dd4a0c9b707975fcecaf8c62c6a2ab43327d46';

// ── Virtual reserve pools ─────────────────────────────────────────────────────
const virtualPools = {
  'USDC/ALEO': {
    tokenIn: 'USDC', tokenOut: 'ALEO',
    virtualReserveIn: 1000000, virtualReserveOut: 2500000,
    k: 1000000 * 2500000,
    swapFeeBps: 30, protocolFeeBps: 5,
    oraclePrice: 0.40, active: true,
    volume24h: 0, totalFeesCollected: 0,
  },
  'ALEO/USDC': {
    tokenIn: 'ALEO', tokenOut: 'USDC',
    virtualReserveIn: 2500000, virtualReserveOut: 1000000,
    k: 2500000 * 1000000,
    swapFeeBps: 30, protocolFeeBps: 5,
    oraclePrice: 2.50, active: true,
    volume24h: 0, totalFeesCollected: 0,
  },
  'USDC/USDCx': {
    tokenIn: 'USDC', tokenOut: 'USDCx',
    virtualReserveIn: 2000000, virtualReserveOut: 2000000,
    k: 2000000 * 2000000,
    swapFeeBps: 10, protocolFeeBps: 2,
    oraclePrice: 1.00, active: true,
    volume24h: 0, totalFeesCollected: 0,
  },
  'USDCx/USDC': {
    tokenIn: 'USDCx', tokenOut: 'USDC',
    virtualReserveIn: 2000000, virtualReserveOut: 2000000,
    k: 2000000 * 2000000,
    swapFeeBps: 10, protocolFeeBps: 2,
    oraclePrice: 1.00, active: true,
    volume24h: 0, totalFeesCollected: 0,
  },
  'USDC/USAD': {
    tokenIn: 'USDC', tokenOut: 'USAD',
    virtualReserveIn: 2000000, virtualReserveOut: 2000000,
    k: 2000000 * 2000000,
    swapFeeBps: 10, protocolFeeBps: 2,
    oraclePrice: 1.00, active: true,
    volume24h: 0, totalFeesCollected: 0,
  },
  'USDCx/USAD': {
    tokenIn: 'USDCx', tokenOut: 'USAD',
    virtualReserveIn: 500000, virtualReserveOut: 500000,
    k: 500000 * 500000,
    swapFeeBps: 10, protocolFeeBps: 2,
    oraclePrice: 1.00, active: true,
    volume24h: 0, totalFeesCollected: 0,
  },
};

const swapRecords = [];
const trustCache = new Map();

// ── HiveCurve: Δy = y - k / ((x + Δx) · τ) ──────────────────────────────────
function hiveCurveQuote(pool, amountIn, trustScore) {
  const tau = Math.min(100, Math.max(0, trustScore)) / 100;
  if (tau < 0.1) return null;
  const fee = amountIn * (pool.swapFeeBps / 10000);
  const protocolFee = amountIn * (pool.protocolFeeBps / 10000);
  const amountInAfterFee = amountIn - fee;
  const { virtualReserveIn: x, virtualReserveOut: y, k } = pool;
  const amountOut = y - k / ((x + amountInAfterFee) * tau);
  if (amountOut <= 0) return null;
  return {
    amountOut,
    fee,
    protocolFee,
    priceImpact: amountInAfterFee / (x + amountInAfterFee),
    impliedPrice: amountIn / amountOut,
    tau,
  };
}

function getPairKey(tokenIn, tokenOut) {
  const k = `${tokenIn.toUpperCase()}/${tokenOut.toUpperCase()}`;
  return virtualPools[k] ? k : null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hiveswap',
    version: '2.0.0',
    phase: 'vAMM',
    pairs: Object.keys(virtualPools).length,
    timestamp: new Date().toISOString(),
    _hive: { network: 'Hive Civilization', settlement: 'USDC on Base L2', design: 'HiveCurve τ-adjusted' },
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err) res.json({ service: 'hiveswap', status: 'ok', docs: '/health' });
  });
});

app.get('/v1/swap/pools', (req, res) => {
  const pools = Object.entries(virtualPools).map(([pairId, pool]) => ({
    pair_id: pairId,
    token_in: pool.tokenIn,
    token_out: pool.tokenOut,
    virtual_reserve_in: pool.virtualReserveIn,
    virtual_reserve_out: pool.virtualReserveOut,
    oracle_price: pool.oraclePrice,
    swap_fee_bps: pool.swapFeeBps,
    protocol_fee_bps: pool.protocolFeeBps,
    active: pool.active,
    volume_24h_usdc: pool.volume24h,
    fees_collected_usdc: pool.totalFeesCollected,
    phase: 'vAMM',
    backstop: 'HiveBank treasury',
  }));
  res.json({
    ok: true, pools, count: pools.length,
    phase: 'vAMM — virtual reserves, HiveBank backstop',
    migration_threshold_usdc: 50000,
    _hive: { service: 'hiveswap', timestamp: new Date().toISOString() },
  });
});

app.get('/v1/swap/quote', (req, res) => {
  const { token_in, token_out, amount_in, agent_did } = req.query;
  if (!token_in || !token_out || !amount_in) {
    return res.status(400).json({
      error: 'missing_params',
      message: 'Required: token_in, token_out, amount_in',
      example: '/v1/swap/quote?token_in=USDC&token_out=ALEO&amount_in=100',
    });
  }
  const pairKey = getPairKey(token_in, token_out);
  if (!pairKey) {
    return res.status(404).json({
      error: 'pair_not_found',
      message: `No pool for ${token_in}/${token_out}`,
      available_pairs: Object.keys(virtualPools),
    });
  }
  const pool = virtualPools[pairKey];
  if (!pool.active) return res.status(503).json({ error: 'pool_paused' });
  const amtIn = parseFloat(amount_in);
  if (isNaN(amtIn) || amtIn <= 0) return res.status(400).json({ error: 'invalid_amount' });
  let trustScore = agent_did ? 60 : 75;
  if (agent_did) {
    const cached = trustCache.get(agent_did);
    if (cached && Date.now() - cached.ts < 3600000) trustScore = cached.score;
    else trustCache.set(agent_did, { score: 60, ts: Date.now() });
  }
  const quote = hiveCurveQuote(pool, amtIn, trustScore);
  if (!quote) return res.status(400).json({ error: 'quote_failed', message: 'Insufficient liquidity or trust too low' });
  res.json({
    ok: true,
    quote_id: `q_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    pair: pairKey,
    token_in: token_in.toUpperCase(),
    token_out: token_out.toUpperCase(),
    amount_in: amtIn,
    amount_out: parseFloat(quote.amountOut.toFixed(6)),
    fee_amount: parseFloat(quote.fee.toFixed(6)),
    protocol_fee: parseFloat(quote.protocolFee.toFixed(6)),
    implied_price: parseFloat(quote.impliedPrice.toFixed(8)),
    oracle_price: pool.oraclePrice,
    price_impact_pct: parseFloat((quote.priceImpact * 100).toFixed(4)),
    trust_score: trustScore,
    settlement_rail: 'USDC/Base-L2',
    phase: 'vAMM',
    expires_at: new Date(Date.now() + 30000).toISOString(),
    _hive: { note: 'HiveCurve pricing — higher trust = better rates', backstop: 'HiveBank treasury' },
  });
});

app.post('/v1/swap/execute', (req, res) => {
  const { token_in, token_out, amount_in, min_amount_out, agent_did, settlement_rail } = req.body;
  if (!token_in || !token_out || !amount_in || !agent_did) {
    return res.status(400).json({ error: 'missing_params', required: ['token_in', 'token_out', 'amount_in', 'agent_did'] });
  }
  if (!agent_did.startsWith('did:')) {
    return res.status(400).json({ error: 'invalid_did', message: 'agent_did must be a valid DID', onboard: 'https://hivegate.onrender.com/v1/gate/onboard' });
  }
  const pairKey = getPairKey(token_in, token_out);
  if (!pairKey) return res.status(404).json({ error: 'pair_not_found', available_pairs: Object.keys(virtualPools) });
  const pool = virtualPools[pairKey];
  if (!pool.active) return res.status(503).json({ error: 'pool_paused' });
  const amtIn = parseFloat(amount_in);
  const minOut = min_amount_out ? parseFloat(min_amount_out) : 0;
  const cached = trustCache.get(agent_did);
  const trustScore = cached ? cached.score : 60;
  const quote = hiveCurveQuote(pool, amtIn, trustScore);
  if (!quote) return res.status(400).json({ error: 'swap_failed' });
  if (quote.amountOut < minOut) {
    return res.status(400).json({ error: 'slippage_exceeded', amount_out_quoted: quote.amountOut.toFixed(6), min_amount_out: minOut });
  }
  const swapId = `swap_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  const now = new Date().toISOString();
  const record = {
    swap_id: swapId, pair: pairKey,
    token_in: token_in.toUpperCase(), token_out: token_out.toUpperCase(),
    amount_in: amtIn, amount_out: parseFloat(quote.amountOut.toFixed(6)),
    fee: parseFloat(quote.fee.toFixed(6)), protocol_fee: parseFloat(quote.protocolFee.toFixed(6)),
    agent_did, trust_score: trustScore, settlement_rail: settlement_rail || 'usdc',
    status: 'SETTLED', phase: 1, created_at: now, settled_at: now,
  };
  swapRecords.push(record);
  pool.virtualReserveIn += amtIn;
  pool.virtualReserveOut = Math.max(1, pool.virtualReserveOut - quote.amountOut);
  pool.volume24h += amtIn;
  pool.totalFeesCollected += quote.protocolFee;
  res.status(201).json({
    ok: true, swap_id: swapId, status: 'SETTLED',
    pair: pairKey, token_in: token_in.toUpperCase(), token_out: token_out.toUpperCase(),
    amount_in: amtIn, amount_out: parseFloat(quote.amountOut.toFixed(6)),
    fee_charged: parseFloat(quote.fee.toFixed(6)),
    protocol_fee_collected: parseFloat(quote.protocolFee.toFixed(6)),
    implied_price: parseFloat(quote.impliedPrice.toFixed(8)),
    price_impact_pct: parseFloat((quote.priceImpact * 100).toFixed(4)),
    trust_score: trustScore, settlement_rail: settlement_rail || 'usdc',
    settled_at: now, phase: 'vAMM Phase 1',
    _hive: { protocol_fee_routed_to: 'HiveBank treasury fee vault', note: 'Phase 1: simulated. Phase 2: real USDC on Base L2.' },
  });
});

app.get('/v1/swap/history', (req, res) => {
  const { agent_did, limit = 20 } = req.query;
  let records = agent_did ? swapRecords.filter(r => r.agent_did === agent_did) : swapRecords;
  res.json({ ok: true, swaps: records.slice(-parseInt(limit)).reverse(), count: records.length, total_swaps: swapRecords.length });
});

app.get('/v1/swap/stats', (req, res) => {
  const totalVolume = swapRecords.reduce((s, r) => s + r.amount_in, 0);
  const totalFees = swapRecords.reduce((s, r) => s + r.protocol_fee, 0);
  res.json({
    ok: true, total_swaps: swapRecords.length,
    total_volume_usdc: parseFloat(totalVolume.toFixed(2)),
    total_protocol_fees_usdc: parseFloat(totalFees.toFixed(4)),
    pools: Object.keys(virtualPools).length, phase: 'vAMM',
    migration_trigger_usdc: 50000,
    migration_progress_pct: parseFloat(((totalFees / 50000) * 100).toFixed(2)),
    _hive: { timestamp: new Date().toISOString() },
  });
});

// MCP compatibility endpoint (keep for existing clients)
app.post('/mcp', (req, res) => {
  const { method, params } = req.body || {};
  if (method === 'tools/list') {
    return res.json({ tools: [
      { name: 'swap_quote', description: 'Get a HiveCurve quote', inputSchema: { type: 'object', properties: { token_in: { type: 'string' }, token_out: { type: 'string' }, amount_in: { type: 'number' }, agent_did: { type: 'string' } }, required: ['token_in', 'token_out', 'amount_in'] } },
      { name: 'swap_execute', description: 'Execute a token swap', inputSchema: { type: 'object', properties: { token_in: { type: 'string' }, token_out: { type: 'string' }, amount_in: { type: 'number' }, agent_did: { type: 'string' } }, required: ['token_in', 'token_out', 'amount_in', 'agent_did'] } },
      { name: 'list_pools', description: 'List all liquidity pools', inputSchema: { type: 'object', properties: {} } },
    ]});
  }
  res.status(404).json({ error: 'unknown_method' });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'not_found', service: 'hiveswap',
    available: ['GET /health', 'GET /v1/swap/pools', 'GET /v1/swap/quote', 'POST /v1/swap/execute', 'GET /v1/swap/stats'],
    _hive: { timestamp: new Date().toISOString() },
  });
});

app.listen(PORT, () => {
  console.log(`HiveSwap vAMM v2.0 on port ${PORT}`);
  console.log(`Pairs: ${Object.keys(virtualPools).join(', ')}`);
});

export default app;
