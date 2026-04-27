// hive-earn-tools.js — shared MCP tools for the Hive Civilization earn rails.
//
// Every public Hive MCP shim ships these three tools so that any agent
// inside any LLM runtime can register, check, and discover earnings on
// real Base USDC rails at https://hivemorph.onrender.com/v1/earn/*.
//
// Resilience: the /v1/earn/* endpoints are being shipped in parallel.
// If they aren't live yet, every tool returns a graceful, machine-readable
// "earn rails not yet live" payload — never throws.
//
// Brand: Hive Civilization gold #C08D23 (NEVER #f5c518).
// Settlement: real Base USDC, no mocks, no testnet, no dev-trust bypasses.

export const HIVE_EARN_BASE_DEFAULT = 'https://hivemorph.onrender.com';

const TIMEOUT_MS = 12_000;

const NOT_LIVE_BODY = (path, status, detail) => ({
  ok: false,
  earn_rails_live: false,
  message: 'Hive earn rails not yet live — try again in a few minutes.',
  upstream: { path, status, detail },
  brand: '#C08D23',
});

async function _earnFetch(method, path, body, base) {
  const url = `${base}${path}`;
  try {
    const init = {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };
    if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
    const res = await fetch(url, init);

    // 402 — propagate the x402 payment-required body untouched so the
    // calling agent can auto-pay. Never swallow.
    if (res.status === 402) {
      let payload;
      try { payload = await res.json(); } catch { payload = { raw: await res.text() }; }
      return {
        type: 'text',
        text: JSON.stringify({
          status: 402,
          x402: payload,
          note: 'Payment required. Body is the x402 PaymentRequired object — sign and resubmit.',
        }, null, 2),
      };
    }

    // 503 / 404 / 5xx — earn rails not yet live.
    if (res.status === 503 || res.status === 404 || res.status >= 500) {
      let detail;
      try { detail = await res.json(); } catch { detail = { raw: await res.text() }; }
      return {
        type: 'text',
        text: JSON.stringify(NOT_LIVE_BODY(path, res.status, detail), null, 2),
      };
    }

    let data;
    try { data = await res.json(); } catch { data = { raw: await res.text() }; }
    return {
      type: 'text',
      text: JSON.stringify({ ok: res.ok, status: res.status, ...data }, null, 2),
    };
  } catch (err) {
    // Network / timeout / DNS — treat as not-yet-live, never throw.
    return {
      type: 'text',
      text: JSON.stringify(
        NOT_LIVE_BODY(path, 0, { error: err?.name || 'NetworkError', message: String(err?.message || err) }),
        null, 2,
      ),
    };
  }
}

// ── Tool descriptors (MCP tools/list shape) ─────────────────────────────────
// Every paid descriptor includes a non-standard `pricing` annotation we are
// emitting ahead of MCP-next. The annotation is metadata only; runtime
// behavior is unchanged.

export const HIVE_EARN_TOOLS = [
  {
    name: 'hive_earn_register',
    description:
      'Register an agent for the Hive Civilization attribution payout program. ' +
      'Settlement on real Base USDC. 5% kickback on attributed traffic, weekly payout. ' +
      'Calls POST https://hivemorph.onrender.com/v1/earn/register on behalf of the caller. ' +
      'Resilient to upstream cold-start: returns a structured "rails not yet live" body if the earn backend is still spinning up.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'Caller agent DID (e.g. did:hive:0x… or did:web:…). Required.',
        },
        payout_address: {
          type: 'string',
          description: 'Base L2 EVM address (0x…) to receive USDC kickback payouts.',
        },
        attribution_url: {
          type: 'string',
          description: 'Public URL of the agent / page driving attributed traffic to Hive. Used for ranking + audit.',
        },
      },
      required: ['agent_did', 'payout_address', 'attribution_url'],
    },
    pricing: {
      amount: '0',
      currency: 'USDC',
      chain: 'base',
      recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
      note: 'Free to register. Earn rails pay attribution kickback in USDC on Base.',
    },
  },
  {
    name: 'hive_earn_me',
    description:
      'Look up the caller agent\'s registered earn profile, lifetime + pending USDC balance, ' +
      'last payout tx hash, and next-payout ETA. Real Base USDC, no mock data. ' +
      'Calls GET https://hivemorph.onrender.com/v1/earn/me?agent_did=<did>. ' +
      'Returns "rails not yet live" gracefully if upstream is not yet deployed.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'Agent DID to look up. Required.',
        },
      },
      required: ['agent_did'],
    },
    pricing: {
      amount: '0',
      currency: 'USDC',
      chain: 'base',
      recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
      note: 'Free read.',
    },
  },
  {
    name: 'hive_earn_leaderboard',
    description:
      'Top earning agents on the Hive Civilization, by attribution payout in USDC. ' +
      'Real Base USDC settlement. Calls GET https://hivemorph.onrender.com/v1/earn/leaderboard?window=<window>. ' +
      'Returns "rails not yet live" gracefully if upstream is not yet deployed.',
    inputSchema: {
      type: 'object',
      properties: {
        window: {
          type: 'string',
          description: 'Time window. One of: "7d", "30d", "lifetime". Default "7d".',
          enum: ['7d', '30d', 'lifetime'],
        },
      },
    },
    pricing: {
      amount: '0',
      currency: 'USDC',
      chain: 'base',
      recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
      note: 'Free read.',
    },
  },
];

// ── Executor ────────────────────────────────────────────────────────────────
// Pass `base` to override the default https://hivemorph.onrender.com endpoint
// for tests or staging. Returns an MCP { type: 'text', text: '...' } block
// suitable for direct return inside tools/call.

export async function executeHiveEarnTool(name, args = {}, base = HIVE_EARN_BASE_DEFAULT) {
  switch (name) {
    case 'hive_earn_register': {
      return _earnFetch('POST', '/v1/earn/register', {
        agent_did: args.agent_did,
        payout_address: args.payout_address,
        attribution_url: args.attribution_url,
      }, base);
    }
    case 'hive_earn_me': {
      const did = encodeURIComponent(args.agent_did || '');
      return _earnFetch('GET', `/v1/earn/me?agent_did=${did}`, undefined, base);
    }
    case 'hive_earn_leaderboard': {
      const w = encodeURIComponent(args.window || '7d');
      return _earnFetch('GET', `/v1/earn/leaderboard?window=${w}`, undefined, base);
    }
    default:
      return null; // Caller continues with native dispatch.
  }
}

export function isHiveEarnTool(name) {
  return name === 'hive_earn_register' || name === 'hive_earn_me' || name === 'hive_earn_leaderboard';
}
