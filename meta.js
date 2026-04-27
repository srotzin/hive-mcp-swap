// meta.js — shared meta tag / JSON-LD / robots / security helper
// Hive Civilization gold #C08D23 (Pantone 1245 C). Never #f5c518.
//
// Drop-in for hive-mcp-* shim servers. Exports renderLanding(),
// renderRobots(), renderSecurity(), renderOgImage(), and seoJson().
//
// Do not edit per-repo — substitute the SERVICE block at module top.

export const BRAND_GOLD = '#C08D23';
export const ORG_NAME = 'Hive Civilization';
export const AUTHOR = 'Steve Rotzin / Hive Civilization';
export const AUTHOR_EMAIL = 'steve@thehiveryiq.com';
export const CANONICAL_GATEWAY = 'https://hive-mcp-gateway.onrender.com';

/**
 * @param {{
 *   service:    string,    // e.g. "hive-mcp-trade"
 *   title:      string,    // SEO title
 *   tagline:    string,    // one-liner under heading
 *   description: string,   // long-form, ~160 chars optimal
 *   keywords:   string[],
 *   tools:      Array<{name:string, description:string}>,
 *   gatewayMount: string,  // e.g. "/trade"
 *   externalUrl: string,   // public URL for canonical
 *   pricing:    Array<{name:string, priceUsd:number|string, label?:string}>,
 *   version:    string
 * }} cfg
 */
export function seoJson(cfg) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: cfg.title,
    description: cfg.description,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'AI Agent / MCP Server',
    operatingSystem: 'Any (HTTP)',
    url: cfg.externalUrl,
    softwareVersion: cfg.version,
    publisher: {
      '@type': 'Organization',
      name: ORG_NAME,
      url: 'https://hive-mcp-gateway.onrender.com',
    },
    author: {
      '@type': 'Person',
      name: 'Steve Rotzin',
      email: AUTHOR_EMAIL,
      url: 'https://www.thehiveryiq.com',
    },
    offers: (cfg.pricing && cfg.pricing.length)
      ? cfg.pricing.map(p => ({
          '@type': 'Offer',
          name: p.label || p.name,
          price: typeof p.priceUsd === 'number' ? p.priceUsd.toString() : p.priceUsd,
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: p.priceUsd,
            priceCurrency: 'USD',
            unitText: 'per call (settled in USDC on Base L2)',
          },
        }))
      : [{ '@type': 'Offer', price: '0', priceCurrency: 'USD' }],
    keywords: cfg.keywords.join(', '),
    isAccessibleForFree: false,
    inLanguage: 'en',
  };
}

export function renderLanding(cfg) {
  const ld = seoJson(cfg);
  const toolList = (cfg.tools || []).map(t =>
    `<li><code>${t.name}</code> — ${t.description}</li>`
  ).join('\n');
  const kw = cfg.keywords.join(', ');
  const externalUrl = cfg.externalUrl;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${cfg.title}</title>
<meta name="description" content="${cfg.description}"/>
<meta name="keywords" content="${kw}"/>
<meta name="author" content="${AUTHOR}"/>
<meta name="theme-color" content="${BRAND_GOLD}"/>
<meta name="robots" content="index,follow,max-image-preview:large"/>
<link rel="canonical" href="${externalUrl}/"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="${ORG_NAME}"/>
<meta property="og:title" content="${cfg.title}"/>
<meta property="og:description" content="${cfg.description}"/>
<meta property="og:url" content="${externalUrl}/"/>
<meta property="og:image" content="${externalUrl}/og.svg"/>
<meta property="og:image:type" content="image/svg+xml"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${cfg.title}"/>
<meta name="twitter:description" content="${cfg.description}"/>
<meta name="twitter:image" content="${externalUrl}/og.svg"/>
<meta name="twitter:creator" content="@hivecivilization"/>
<link rel="icon" href="${externalUrl}/og.svg" type="image/svg+xml"/>
<link rel="alternate" type="application/json" title="MCP discovery" href="${externalUrl}/.well-known/mcp.json"/>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#0d0a06; color:#fbf6ec; line-height:1.55; }
  header { padding:64px 32px 48px; max-width:960px; margin:0 auto; }
  header .eyebrow { color:${BRAND_GOLD}; font-family:ui-monospace,monospace; letter-spacing:6px;
                    text-transform:uppercase; font-size:13px; margin:0 0 18px; }
  header h1 { font-size:48px; line-height:1.1; margin:0 0 12px; letter-spacing:-1px; }
  header .tagline { color:rgba(251,246,236,.78); font-size:20px; margin:0 0 28px; }
  .endpoint { background:rgba(192,141,35,.08); border:1px solid rgba(192,141,35,.2);
              padding:16px 20px; border-radius:8px; font-family:ui-monospace,monospace;
              color:${BRAND_GOLD}; word-break:break-all; }
  main { max-width:960px; margin:0 auto; padding:0 32px 64px; }
  h2 { color:${BRAND_GOLD}; font-size:14px; letter-spacing:3px; text-transform:uppercase;
       margin:48px 0 16px; }
  ul.tools { padding-left:0; list-style:none; display:grid; gap:8px; }
  ul.tools li { padding:12px 16px; border:1px solid rgba(251,246,236,.08); border-radius:6px;
                background:rgba(251,246,236,.02); }
  ul.tools code { color:${BRAND_GOLD}; font-size:14px; }
  footer { max-width:960px; margin:0 auto; padding:32px; border-top:1px solid rgba(251,246,236,.08);
           color:rgba(251,246,236,.55); font-size:13px; }
  footer a { color:${BRAND_GOLD}; text-decoration:none; }
  footer a:hover { text-decoration:underline; }
</style>
</head>
<body>
  <header>
    <p class="eyebrow">${ORG_NAME} · MCP Server</p>
    <h1>${cfg.title}</h1>
    <p class="tagline">${cfg.tagline}</p>
    <div class="endpoint">${externalUrl}/mcp</div>
  </header>
  <main>
    <h2>What this is</h2>
    <p>${cfg.description}</p>
    <p>Settlement is real: <strong>USDC on Base L2</strong> via Hive Civilization rails. No simulated proofs, no mock receipts. Pricing is per-call; see JSON-LD <code>offers</code> for the full schedule.</p>

    <h2>Tools (${(cfg.tools || []).length})</h2>
    <ul class="tools">${toolList}</ul>

    <h2>Discovery</h2>
    <ul class="tools">
      <li><code>GET /.well-known/mcp.json</code> — MCP discovery descriptor</li>
      <li><code>GET /health</code> — health + telemetry</li>
      <li><code>POST /mcp</code> — JSON-RPC 2.0 over Streamable-HTTP, MCP 2024-11-05</li>
      <li><code>GET /sitemap.xml</code> — crawler sitemap</li>
      <li><code>GET /robots.txt</code> — allow-all crawl policy</li>
      <li><code>GET /.well-known/security.txt</code> — security contact</li>
    </ul>
  </main>
  <footer>
    <p>${cfg.service} v${cfg.version} · brand <code style="color:${BRAND_GOLD}">${BRAND_GOLD}</code> · Author ${AUTHOR}</p>
    <p>Repo: <a href="https://github.com/srotzin/${cfg.service}">github.com/srotzin/${cfg.service}</a> · Smithery: <a href="https://smithery.ai/server/hivecivilization">hivecivilization</a> · MCP catalog: <a href="https://glama.ai/mcp/servers">Glama</a></p>
  </footer>
</body>
</html>`;
}

export function renderRobots(cfg) {
  return [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${cfg.externalUrl}/sitemap.xml`,
    '',
    '# Hive Civilization · public discovery surface · indexing welcome',
  ].join('\n');
}

export function renderSitemap(cfg) {
  const base = cfg.externalUrl;
  const urls = [
    '/',
    '/mcp',
    '/health',
    '/.well-known/mcp.json',
    '/.well-known/security.txt',
    '/og.svg',
  ];
  const items = urls.map(u => `  <url><loc>${base}${u}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
}

export function renderSecurity() {
  // RFC 9116 security.txt
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return [
    `Contact: mailto:${AUTHOR_EMAIL}`,
    `Expires: ${expires}`,
    `Preferred-Languages: en`,
    `Canonical: ${CANONICAL_GATEWAY}/.well-known/security.txt`,
    `Policy: https://www.thehiveryiq.com`,
    '',
    `# Hive Civilization · security disclosure contact`,
  ].join('\n');
}

export function renderOgImage(cfg) {
  // 1200x630 SVG OG card. Uses brand gold #C08D23 only (never #f5c518).
  const safeTitle = (cfg.shortName || cfg.service).replace(/[<>&]/g, '');
  const safeTagline = (cfg.tagline || '').slice(0, 80).replace(/[<>&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d0a06"/>
      <stop offset="100%" stop-color="#1a1410"/>
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="20%" r="60%">
      <stop offset="0%" stop-color="${BRAND_GOLD}" stop-opacity=".25"/>
      <stop offset="100%" stop-color="${BRAND_GOLD}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(80,90)">
    <text font-family="ui-monospace,monospace" font-size="22" fill="${BRAND_GOLD}" letter-spacing="6">HIVE CIVILIZATION · MCP SERVER</text>
    <text y="140" font-family="ui-sans-serif,system-ui,sans-serif" font-size="96" font-weight="800" fill="#fbf6ec" letter-spacing="-2">${safeTitle}</text>
    <text y="240" font-family="ui-sans-serif,system-ui,sans-serif" font-size="32" fill="rgba(251,246,236,.78)">${safeTagline}</text>
    <g transform="translate(0,360)" font-family="ui-monospace,monospace" font-size="22" fill="${BRAND_GOLD}">
      <text>USDC on Base L2 · MCP 2024-11-05 · real rails · no mocks</text>
    </g>
  </g>
  <g transform="translate(0,560)" font-family="ui-monospace,monospace" font-size="16" fill="rgba(251,246,236,.5)">
    <text x="80">${cfg.externalUrl.replace(/^https?:\/\//, '')}</text>
    <text x="1120" text-anchor="end">v${cfg.version} · ${BRAND_GOLD}</text>
  </g>
</svg>`;
}
