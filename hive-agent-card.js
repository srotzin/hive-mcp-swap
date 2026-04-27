// hive-agent-card.js — emits A2A AgentCard + Open Agent Card JSON-LD.
//
// One file dropped into every Hive MCP shim. The shim passes its own
// per-repo metadata in via `cfg`; this module produces:
//
//   • /.well-known/agent.json — A2A-compatible AgentCard
//     (https://github.com/a2aproject/A2A)
//   • renderRootHtml() — HTML root response with inline JSON-LD that
//     emits BOTH @type SoftwareApplication AND @type AgentCard
//     under @context [ "https://schema.org", "https://a2a-protocol.org/v1" ]
//   • renderOgImageSvg() — fallback 1200x630 brand-gold SVG so OG cards
//     resolve even if the gateway og.svg isn't reachable.
//
// Brand: Hive Civilization gold #C08D23 (NEVER #f5c518).
// Settlement: real Base USDC. No mock, no testnet, no dev-trust.

export const HIVE_BRAND_GOLD = '#C08D23';
export const HIVE_PROVIDER_URL = 'https://hivemorph.onrender.com';
export const HIVE_PROVIDER_ORG = 'Hive Civilization';
export const HIVE_AUTHOR = 'Steve Rotzin';
export const HIVE_AUTHOR_EMAIL = 'steve@thehiveryiq.com';

// Canonical EVM recipient — RAILS_RULES.md Rule 5. Same key used across all
// EVM chains (Base + Ethereum). Hardcoded; do not parameterize.
export const HIVE_BASE_USDC_RECIPIENT = '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e';

// Default attribution policy across all shims (the Hive earn rail).
export const HIVE_ATTRIBUTION = {
  kickbackPercent: 5,
  payoutSchedule: 'weekly',
  payoutChain: 'base',
  payoutCurrency: 'USDC',
  payoutRecipient: 'attributed agent payout_address (set via hive_earn_register)',
};

function toolToSkill(tool) {
  const exampleArgs = {};
  const props = tool?.inputSchema?.properties || {};
  for (const [k, v] of Object.entries(props)) {
    if (v?.enum?.length) exampleArgs[k] = v.enum[0];
    else if (v?.type === 'number' || v?.type === 'integer') exampleArgs[k] = 0;
    else if (v?.type === 'boolean') exampleArgs[k] = false;
    else exampleArgs[k] = `<${k}>`;
  }
  return {
    id: tool.name,
    name: tool.name,
    description: tool.description,
    tags: ['mcp', 'hive', 'a2a', 'usdc', 'base'],
    examples: [{ name: `${tool.name}-example`, input: { name: tool.name, arguments: exampleArgs } }],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

function toolToPricing(tool) {
  const p = tool.pricing || {};
  return {
    tool: tool.name,
    amount: String(p.amount ?? '0'),
    currency: p.currency || 'USDC',
    chain: p.chain || 'base',
    recipient: p.recipient || HIVE_BASE_USDC_RECIPIENT,
  };
}

export function buildAgentCard(cfg) {
  const skills = (cfg.tools || []).map(toolToSkill);
  return {
    name: cfg.name,
    description: cfg.description,
    url: cfg.url,
    provider: { organization: HIVE_PROVIDER_ORG, url: HIVE_PROVIDER_URL },
    version: cfg.version,
    documentationUrl: cfg.repoUrl,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    authentication: { schemes: ['x402'] },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills,
    'x-hive': {
      brand_gold: HIVE_BRAND_GOLD,
      did: cfg.did,
      attribution: HIVE_ATTRIBUTION,
      settlement: {
        rail: 'base-usdc',
        recipient: HIVE_BASE_USDC_RECIPIENT,
        no_mock: true,
        no_testnet: true,
      },
      gates: ['NEED', 'YIELD', 'CLEAN-MONEY'],
    },
  };
}

export function buildOacJsonLd(cfg) {
  const pricing = (cfg.tools || []).map(toolToPricing);
  const capabilities = (cfg.tools || []).map((t) => ({
    '@type': 'AgentCapability',
    name: t.name,
    description: t.description,
  }));
  return {
    '@context': ['https://schema.org', 'https://a2a-protocol.org/v1'],
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: cfg.name,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any (HTTP)',
        url: cfg.url,
        description: cfg.description,
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'USDC',
          highPrice: pricing.reduce((m, p) => Math.max(m, parseFloat(p.amount) || 0), 0).toFixed(4),
          lowPrice: '0.0000',
          offerCount: pricing.length,
        },
        provider: { '@type': 'Organization', name: HIVE_PROVIDER_ORG, url: HIVE_PROVIDER_URL },
        author: { '@type': 'Person', name: HIVE_AUTHOR, email: HIVE_AUTHOR_EMAIL },
        sameAs: [cfg.repoUrl].filter(Boolean),
        version: cfg.version,
      },
      {
        '@type': 'AgentCard',
        name: cfg.name,
        description: cfg.description,
        url: cfg.url,
        version: cfg.version,
        identity: {
          did: cfg.did,
          controller: HIVE_PROVIDER_ORG,
          publicKey: cfg.publicKey || null,
        },
        capabilities,
        pricing,
        attribution: HIVE_ATTRIBUTION,
      },
    ],
  };
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const inlineLdJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

export function renderRootHtml(cfg) {
  const ld = buildOacJsonLd(cfg);
  const ldText = inlineLdJson(ld);
  const safeName = escapeHtml(cfg.name);
  const safeDesc = escapeHtml(cfg.description);
  const safeUrl = escapeHtml(cfg.url);
  const safeRepo = escapeHtml(cfg.repoUrl || 'https://github.com/srotzin');
  const safeGw = escapeHtml(cfg.gatewayUrl || 'https://hive-mcp-gateway.onrender.com');
  const toolList = (cfg.tools || [])
    .map((t) => `<li><code>${escapeHtml(t.name)}</code> — ${escapeHtml(t.description.slice(0, 140))}</li>`)
    .join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${safeName} · Hive Civilization MCP</title>
<meta name="description" content="${safeDesc}"/>
<meta name="theme-color" content="${HIVE_BRAND_GOLD}"/>
<link rel="canonical" href="${safeUrl}"/>
<link rel="alternate" type="application/json" href="/.well-known/agent.json" title="A2A AgentCard"/>
<link rel="alternate" type="application/json" href="/.well-known/mcp.json" title="MCP server descriptor"/>
<script type="application/ld+json">${ldText}</script>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#0d0a06; color:#fbf6ec; line-height:1.5; }
  header { padding: 64px 32px 32px; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 2.4rem; margin: 0 0 8px; letter-spacing: -0.5px; }
  h1 .gold { color: ${HIVE_BRAND_GOLD}; }
  .blurb { color: rgba(251,246,236,.78); margin: 0 0 24px; max-width: 640px; }
  main { padding: 0 32px 64px; max-width: 960px; margin: 0 auto; }
  .card { background: #14100a; border: 1px solid rgba(192,141,35,.25); border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; }
  code { color: ${HIVE_BRAND_GOLD}; }
  ul { padding-left: 20px; }
  li { margin: 6px 0; }
  a { color: ${HIVE_BRAND_GOLD}; text-decoration: none; }
  a:hover { text-decoration: underline; }
  footer { color: rgba(251,246,236,.5); padding: 24px 32px 48px; max-width: 960px; margin: 0 auto; font-size: 0.9rem; }
</style>
</head>
<body>
<header>
  <h1>${safeName} <span class="gold">·</span> <span class="gold">Hive Civilization MCP</span></h1>
  <p class="blurb">${safeDesc}</p>
</header>
<main>
  <section class="card">
    <p><strong>MCP endpoint</strong> — <code>${safeUrl}/mcp</code></p>
    <p><strong>A2A AgentCard</strong> — <a href="/.well-known/agent.json">/.well-known/agent.json</a></p>
    <p><strong>MCP descriptor</strong> — <a href="/.well-known/mcp.json">/.well-known/mcp.json</a></p>
    <p><strong>Health</strong> — <a href="/health">/health</a></p>
  </section>
  <section class="card">
    <h2>Tools (${(cfg.tools || []).length})</h2>
    <ul>
      ${toolList}
    </ul>
  </section>
  <section class="card">
    <p>Settlement: real Base USDC, recipient <code>${escapeHtml(HIVE_BASE_USDC_RECIPIENT)}</code>. No mock. No testnet. No dev-trust.</p>
    <p>Attribution kickback: ${HIVE_ATTRIBUTION.kickbackPercent}% in USDC on Base, ${HIVE_ATTRIBUTION.payoutSchedule} payout. Register via <code>hive_earn_register</code>.</p>
    <p>Gates: NEED + YIELD + CLEAN-MONEY.</p>
  </section>
</main>
<footer>
  Source: <a href="${safeRepo}">${safeRepo}</a> · Gateway: <a href="${safeGw}">${safeGw}</a> · Brand <code>${HIVE_BRAND_GOLD}</code>
</footer>
</body>
</html>
`;
}

export function renderOgImageSvg(cfg) {
  const title = escapeHtml(cfg.name);
  const sub = escapeHtml((cfg.description || '').slice(0, 90));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#0d0a06"/>
  <rect x="0" y="0" width="1200" height="6" fill="${HIVE_BRAND_GOLD}"/>
  <text x="80" y="180" font-family="ui-monospace,monospace" font-size="22" fill="${HIVE_BRAND_GOLD}" letter-spacing="6">HIVE CIVILIZATION · MCP</text>
  <text x="80" y="320" font-family="ui-sans-serif,system-ui,sans-serif" font-size="78" font-weight="800" fill="#fbf6ec">${title}</text>
  <text x="80" y="380" font-family="ui-sans-serif,system-ui,sans-serif" font-size="28" fill="rgba(251,246,236,.78)">${sub}</text>
  <text x="80" y="560" font-family="ui-monospace,monospace" font-size="18" fill="rgba(251,246,236,.5)">a2a · x402 · base usdc · #C08D23</text>
</svg>`;
}
