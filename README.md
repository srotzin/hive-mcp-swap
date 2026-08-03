# hive-mcp-swap

Read-only Paraswap price quotes on Base.

## Live contract

This MCP server exposes one swap capability:

| Surface | Purpose |
|---|---|
| `GET /v1/swap-route/quote` | Request a live Paraswap price quote on Base |
| `swap_route.quote` | Request the same quote through MCP |

The response identifies Paraswap as the provider and preserves the venue names present in the returned route. Hive does not construct, sign, submit, or settle a transaction. It does not collect a routing fee, operate liquidity, or custody funds.

Supported token symbols are ETH, WETH, USDC, and USDT. A caller may also supply a Base token address. The amount must be positive.

## Failure behavior

If Paraswap does not return a usable quote, the HTTP endpoint returns 502 with `no_route_available`. The MCP tool returns a structured error payload. Unknown HTTP paths return 404. Unknown MCP tools and methods return JSON-RPC errors.

There is no execution endpoint. There is no transaction construction endpoint. There is no trust score, AML screening, or receipt-signing claim in the quote response.

## Discovery

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Local liveness and declared capability |
| `POST` | `/mcp` | MCP JSON-RPC 2.0, protocol `2024-11-05` |
| `GET` | `/.well-known/mcp.json` | MCP discovery manifest |
| `GET` | `/.well-known/agent.json` | Agent card |
| `GET` | `/.well-known/security.txt` | Security contact |
| `GET` | `/llms.txt` | Plain-text integration guide |
| `GET` | `/og.svg` | Service image |

## Example

```text
GET https://mcp-swap.thehiveryiq.com/v1/swap-route/quote?tokenIn=ETH&tokenOut=USDC&amountIn=1
```

The quote is informational. A caller that chooses to trade must independently construct, review, sign, and submit a transaction using its own wallet and execution provider.

## Testing

```bash
npm install
npm test
```

The automated suite verifies manifest parity, removal of the former execution surface, honest unknown-route behavior, and the absence of unsupported provider, fee, settlement, AML, and trust claims. A separate live probe verifies that Paraswap can return a current Base quote.

## Directory

- Endpoint: https://mcp-swap.thehiveryiq.com
- Source: https://github.com/srotzin/hive-mcp-swap

Hive Civilization. Brand gold `#C08D23`. Steve Rotzin.
