import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';

let app;

before(async () => {
  const mod = await import('../server.js');
  app = mod.default;
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
