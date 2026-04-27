<!-- HIVE_BANNER_V1 -->
<p align="center">
  <a href="https://hive-mcp-gateway.onrender.com/swap/health">
    <img src="https://hive-mcp-gateway.onrender.com/swap/og.svg" alt="HiveSwap · Agent-Native vAMM DEX MCP" width="100%"/>
  </a>
</p>

<h1 align="center">hive-mcp-swap</h1>

<p align="center"><strong>Agent-native vAMM DEX for USDC, USDCx, USAD, ALEO across 4 settlement rails.</strong></p>

<p align="center">
  <a href="https://smithery.ai/server/hivecivilization"><img alt="Smithery" src="https://img.shields.io/badge/Smithery-hivecivilization-C08D23?style=flat-square"/></a>
  <a href="https://glama.ai/mcp/servers"><img alt="Glama" src="https://img.shields.io/badge/Glama-pending-C08D23?style=flat-square"/></a>
  <a href="https://hive-mcp-gateway.onrender.com/swap/health"><img alt="Live" src="https://img.shields.io/badge/gateway-live-C08D23?style=flat-square"/></a>
  <a href="https://github.com/srotzin/hive-mcp-swap/releases"><img alt="Release" src="https://img.shields.io/github/v/release/srotzin/hive-mcp-swap?style=flat-square&color=C08D23"/></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-C08D23?style=flat-square"/></a>
</p>

<p align="center">
  <code>https://hive-mcp-gateway.onrender.com/swap/mcp</code>
</p>

---

# HiveSwap

**Agent-native vAMM DEX for USDC, USDCx, USAD, ALEO across 4 settlement rails.**

MCP server for HiveSwap — agent-native vAMM DEX. Quote and execute swaps across USDC, USDCx, USAD, and ALEO with sub-2-second Base L2 settlement and ZK-private aleo-usdcx routing. Real rails, no simulated trades.

## What this is

`hive-mcp-swap` is a Model Context Protocol (MCP) server that exposes the HiveSwap platform on the Hive Civilization to any MCP-compatible client (Claude Desktop, Cursor, Manus, etc.). The server proxies to the live production gateway at `https://hive-mcp-gateway.onrender.com`.

- **Protocol:** MCP 2024-11-05 over Streamable-HTTP / JSON-RPC 2.0
- **x402 micropayments:** every paid call produces a real on-chain settlement
- **Rails:** USDC on Base L2 — real rails, no mocks
- **Author:** Steve Rotzin · Hive Civilization · brand gold `#C08D23`

## Endpoints

| Path | Purpose |
|------|---------|
| `POST /mcp` | JSON-RPC 2.0 / MCP 2024-11-05 |
| `GET  /` | HTML landing with comprehensive meta tags + JSON-LD |
| `GET  /health` | Health + telemetry |
| `GET  /.well-known/mcp.json` | MCP discovery descriptor |
| `GET  /.well-known/security.txt` | RFC 9116 security contact |
| `GET  /robots.txt` | Allow-all crawl policy |
| `GET  /sitemap.xml` | Crawler sitemap |
| `GET  /og.svg` | 1200×630 Hive-gold OG image |
| `GET  /seo.json` | JSON-LD structured data (SoftwareApplication) |

## License

MIT. © Steve Rotzin / Hive Civilization. Brand gold `#C08D23` (Pantone 1245 C). Never `#f5c518`.
