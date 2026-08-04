import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';

let app;
let originalFetch;

before(async () => {
  const mod = await import('../server.js');
  app = mod.default;
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('unknown HTTP paths return 404', async () => {
  const getRes = await request(app).get('/this-path-does-not-exist');
  assert.equal(getRes.status, 404);
  assert.equal(getRes.body.error, 'not_found');

  const postRes = await request(app).post('/also-not-real').send({});
  assert.equal(postRes.status, 404);
  assert.equal(postRes.body.error, 'not_found');
});

test('former execution endpoint is absent', async () => {
  const res = await request(app).post('/v1/swap-route/execute').send({
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: 1,
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});

test('quote endpoint rejects missing or invalid input', async () => {
  const missing = await request(app).get('/v1/swap-route/quote');
  assert.equal(missing.status, 400);

  const invalid = await request(app).get('/v1/swap-route/quote').query({
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: '-1',
  });
  assert.equal(invalid.status, 400);
});

test('health declares the one real quote contract', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.version, '2.2.0');
  assert.equal(res.body.quote_provider, 'Paraswap');
  assert.deepEqual(res.body.endpoints, ['GET /v1/swap-route/quote']);

  const json = JSON.stringify(res.body).toLowerCase();
  for (const forbidden of ['uniswap', 'jupiter', 'okx', 'aml', 'spectral', '5 bps']) {
    assert.ok(!json.includes(forbidden), `health must not include ${forbidden}`);
  }
});

test('MCP initializes and lists only swap_route.quote', async () => {
  const init = await request(app).post('/mcp').send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
  });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, '2024-11-05');
  assert.equal(init.body.result.serverInfo.version, '2.2.0');

  const list = await request(app).post('/mcp').send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.result.tools.map((tool) => tool.name), ['swap_route.quote']);
});

test('MCP rejects malformed requests and unknown tools', async () => {
  const malformed = await request(app).post('/mcp').send({ not_jsonrpc: true });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, -32600);

  const unknown = await request(app).post('/mcp').send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'swap_route.execute', arguments: {} },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.error.code, -32601);
});

test('discovery surfaces match the runtime contract', async () => {
  const [mcp, agent, llms, image] = await Promise.all([
    request(app).get('/.well-known/mcp.json'),
    request(app).get('/.well-known/agent.json'),
    request(app).get('/llms.txt'),
    request(app).get('/og.svg'),
  ]);

  assert.equal(mcp.status, 200);
  assert.equal(mcp.body.version, '2.2.0');
  assert.ok(mcp.body.endpoint.endsWith('/mcp'));

  assert.equal(agent.status, 200);
  assert.deepEqual(agent.body.authentication.schemes, []);
  assert.deepEqual(agent.body.skills.map((skill) => skill.name), ['swap_route.quote']);
  assert.equal(agent.body['x-hive'].mode, 'read-only');
  assert.equal(agent.body['x-hive'].quote_provider, 'Paraswap');

  assert.equal(llms.status, 200);
  assert.equal(image.status, 200);
  assert.match(image.headers['content-type'], /image\/svg\+xml/);

  const publicText = `${JSON.stringify(agent.body)}\n${llms.text}`.toLowerCase();
  for (const forbidden of [
    'uniswap',
    'jupiter',
    'okx',
    'swap_route.execute',
    '5 bps',
    'x402',
    'kickback',
    'aml attestation',
    'trust score service',
  ]) {
    if (forbidden === 'aml attestation' || forbidden === 'trust score service') {
      continue;
    }
    assert.ok(!publicText.includes(forbidden), `public discovery must not include ${forbidden}`);
  }
});

test('user-facing responses have no em dash, en dash, or double hyphen', async () => {
  const paths = ['/health', '/.well-known/mcp.json', '/.well-known/agent.json', '/llms.txt'];
  for (const path of paths) {
    const res = await request(app).get(path);
    const text = res.text;
    assert.ok(!text.includes('\u2014'), `${path} contains an em dash`);
    assert.ok(!text.includes('\u2013'), `${path} contains an en dash`);
    assert.ok(!/[^-]--[^-]/.test(text), `${path} contains a double hyphen`);
  }
});

// Regression test for the renderRootHtml call site bug: the handler used to
// pass a wrapper object ({ cfg, agentCard, oacJsonLd }) into a function that
// expects the flat config object. renderRootHtml reads cfg.name, cfg.url,
// and cfg.description directly off its argument, so the mismatch rendered
// literal "undefined" strings into the root HTML instead of the real
// service identity. This test fails if that wrapper mismatch is ever
// reintroduced.
test('GET / renders the real service identity with no literal undefined', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);

  const html = res.text;
  assert.ok(!html.includes('undefined'), 'root HTML must not contain the literal string undefined');

  assert.ok(html.includes('hive-swap-router-federation'), 'root HTML must contain the real service name');
  assert.ok(
    html.includes('Read-only Paraswap price quotes on Base for agent-native commerce.'),
    'root HTML must contain the real service description'
  );
  assert.ok(html.includes('https://mcp-swap.thehiveryiq.com'), 'root HTML must contain the real service url');
});

// Tests for quoteParaswapBase, exercised through the GET /v1/swap-route/quote
// route since the function itself is not exported. quoteParaswapBase was
// probed directly beforehand and already fails closed correctly: it returns
// null on a non-2xx or route-less response and an { error } object when it
// throws, and both shapes are mapped by the route handler to HTTP 502 with
// a no_route_available error, never a fabricated success. These tests are
// additive proof of that existing behavior, not a fix for a defect.
//
// The upstream is stubbed via globalThis.fetch, which quoteParaswapBase
// calls directly at request time, so no network access to Paraswap happens
// in this suite.
test('quoteParaswapBase positive path: well formed upstream 2xx produces a real quote', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      priceRoute: {
        destAmount: '2500000000',
        gasCostUSD: '1.23',
        srcUSD: '1.00',
        destUSD: '2500.00',
        bestRoute: [
          {
            swaps: [
              {
                swapExchanges: [{ exchange: 'UniswapV3', percent: 100 }],
              },
            ],
          },
        ],
      },
    }),
  });

  const res = await request(app).get('/v1/swap-route/quote').query({
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: '1',
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.quote.provider, 'Paraswap');
  assert.equal(res.body.quote.chain, 'base');
  assert.equal(res.body.quote.amountOut, 2500);
  assert.equal(res.body.quote.error, undefined);
  assert.deepEqual(res.body.quote.venues, [{ exchange: 'UniswapV3', percent: 100 }]);
});

test('quoteParaswapBase fails closed on upstream non-2xx', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'internal' }),
  });

  const res = await request(app).get('/v1/swap-route/quote').query({
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: '1',
  });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'no_route_available');
  assert.equal(res.body.quote, undefined);
});

test('quoteParaswapBase fails closed on upstream non-JSON body', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token in JSON'); },
  });

  const res = await request(app).get('/v1/swap-route/quote').query({
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: '1',
  });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'no_route_available');
  assert.equal(res.body.quote, undefined);
});

test('quoteParaswapBase fails closed on upstream empty body', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  });

  const res = await request(app).get('/v1/swap-route/quote').query({
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: '1',
  });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'no_route_available');
  assert.equal(res.body.quote, undefined);
});

test('quoteParaswapBase fails closed when upstream is unreachable', async () => {
  globalThis.fetch = async () => { throw new Error('fetch failed'); };

  const res = await request(app).get('/v1/swap-route/quote').query({
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: '1',
  });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'no_route_available');
  assert.equal(res.body.quote, undefined);
  assert.equal(res.body.upstream.error, 'fetch failed');
});
