# Polymarket Copy-Trading Bot

Autonomous Polymarket trading bot with copy-trading intelligence, powered by Grok 4.20 via OpenRouter.

## Tech Stack

- **Frontend**: Next.js 15 (App Router, Turbopack), React 19, TailwindCSS
- **Backend**: Convex (real-time database + serverless functions)
- **LLM (Chat)**: Grok 4.20 Beta via OpenRouter (`x-ai/grok-4.20-beta`) — supports tool calling
- **LLM (Agent Pipelines)**: Grok 4.20 Multi-Agent Beta via OpenRouter (`x-ai/grok-4.20-multi-agent-beta`) — does NOT support tool calling via OpenRouter
- **Markets**: Polymarket CLOB Client (Polygon, chain 137) + Gamma API
- **Data**: Polymarket Data API (leaderboard, trader activity, positions)
- **Streaming**: AI SDK (`ai` + `@ai-sdk/react` + `@ai-sdk/openai-compatible`) with `streamText`, `smoothStream`, `useChat`

## Important: Model Differences

- **Chat route** (`app/api/chat/route.ts`) uses `x-ai/grok-4.20-beta` because it supports tool calling through OpenRouter. This powers the 5 live Polymarket tools.
- **Backend agent pipelines** (`src/llm/openrouter.ts`) default to `x-ai/grok-4.20-multi-agent-beta` which does NOT support tool calling via OpenRouter. The agent pipeline uses its own tool registry (`src/tools/tool-registry.ts`) with manual tool execution loops instead.

## Project Structure

```
polybot/
├── app/                    # Next.js pages
│   ├── page.tsx            # Dashboard (KPIs, P&L chart, markets)
│   ├── chat/               # Grok 4.20 chat interface
│   │   └── page.tsx        # Chat UI with Streamdown markdown rendering
│   ├── copy-trade/         # Copy-trading UI (traders, signals, activity)
│   │   └── page.tsx        # 3-tab view: Tracked Traders, Signals, Activity
│   ├── markets/            # Market browser + detail views
│   ├── positions/          # Open positions + trade history
│   ├── activity/           # Agent cycle history
│   ├── settings/           # Config + wallet management
│   └── api/chat/           # Streaming chat API route (5 Polymarket tools)
│       └── route.ts        # streamText + tools + smoothStream
├── components/             # React components
│   ├── dashboard/          # KpiStrip, PnlAreaChart, MarketGrid, AgentFeed
│   ├── activity/           # CycleList, CycleCard, StageCard
│   ├── markets/            # MarketHero, OrderBookPanel, OutcomesTable
│   ├── nav/                # Sidebar navigation
│   │   └── sidebar.tsx     # Nav links including Copy Trade
│   ├── providers/          # ConvexProvider
│   └── ui/                 # Card, Button, Badge primitives
├── convex/                 # Convex backend
│   ├── schema.ts           # Database schema (10 tables)
│   ├── agentRun.ts         # Agent cycles: autonomous + copy-trading
│   ├── trades.ts           # Trade CRUD
│   ├── positions.ts        # Position CRUD
│   ├── trackedTraders.ts   # Tracked traders + signals + activity CRUD
│   ├── agentActions.ts     # Pipeline action logging
│   ├── analytics.ts        # Daily/weekly performance metrics
│   ├── config.ts           # Key-value config store
│   ├── wallet.ts           # Mock/real wallet management
│   ├── markets.ts          # Market data queries
│   └── crons.ts            # Scheduled jobs (5 crons)
├── src/
│   ├── agent/
│   │   ├── pipeline.ts     # 6-stage autonomous trading pipeline
│   │   ├── copy-trader.ts  # Copy-trading engine (discovery, scoring, signals)
│   │   ├── prompts.ts      # LLM system + task prompts (dual-mode)
│   │   ├── market-scorer.ts # Market filtering + scoring
│   │   └── risk-manager.ts # Risk checks (confidence, size, exposure)
│   ├── llm/
│   │   ├── openrouter.ts   # OpenRouter provider (Grok 4.20 Multi-Agent default)
│   │   ├── provider.ts     # Provider factory
│   │   └── types.ts        # LLM interface types
│   ├── tools/
│   │   ├── polymarket-client.ts    # CLOB client (orders, orderbook)
│   │   ├── polymarket-scanner.ts   # Gamma API (trending markets)
│   │   ├── polymarket-data-api.ts  # Data API (leaderboard, activity, positions)
│   │   ├── tool-registry.ts        # LLM tool definitions + executor
│   │   ├── firecrawl-search.ts     # Web search
│   │   ├── perplexity-search.ts    # Real-time Q&A
│   │   └── apify-scraper.ts        # Social sentiment
│   ├── lib/
│   │   ├── retry.ts        # Exponential backoff retry utility
│   │   ├── env.ts          # Environment variable helpers
│   │   ├── chart-tools.ts  # Chart utility helpers
│   │   ├── market-utils.tsx # Market display utilities
│   │   └── utils.ts        # cn() and misc utilities
│   └── types/index.ts      # All shared TypeScript types
└── scripts/
    ├── setup-wallet.ts     # Generate/import wallet + derive API creds
    ├── derive-api-keys.ts  # Derive Polymarket CLOB API keys
    ├── seed-config.ts      # Seed default config + mock wallet
    └── seed-mock-data.ts   # Seed mock data for development
```

## Polymarket API Endpoints

| API | Base URL | Used For |
|-----|----------|----------|
| Gamma API | `https://gamma-api.polymarket.com` | Trending markets, market search, event data |
| CLOB API | `https://clob.polymarket.com` | Orderbook, midpoint prices, placing orders |
| Data API | `https://data-api.polymarket.com` | Leaderboard, trader activity, positions |

### Leaderboard API (correct format)
```
GET https://data-api.polymarket.com/v1/leaderboard
  ?timePeriod=WEEK    # DAY, WEEK, MONTH, ALL
  &orderBy=PNL        # PNL or VOL
  &limit=25
  &category=OVERALL
```

## Chat API Tools (route.ts)

The chat route provides 5 live Polymarket tools to Grok:

1. **get_trending_markets** — Top markets by volume (Gamma API events endpoint)
2. **get_market_details** — Search markets by keyword/slug (Gamma API markets endpoint)
3. **get_orderbook** — Live bid/ask/spread for a token (CLOB API book endpoint)
4. **get_leaderboard** — Top traders by PnL/volume (Data API v1 leaderboard, 3 fallback URLs)
5. **get_market_price** — Current midpoint price for a token (CLOB API midpoint endpoint)

## Two Trading Modes

### 1. Autonomous Research Trading (every 15 min)
Pipeline: Scan → Filter → LLM Screen → Deep Research (tools) → Trade Decision → Risk Check → Execute

### 2. Copy-Trading (every 10 min)
Pipeline: Discover Top Traders → Scan Activity → Generate Consensus Signals → LLM Validation → Execute

Copy-trading scores traders using a composite of PnL (35%), win rate (25%), volume (20%), and recency (20%). Only copies trades where multiple top traders agree (consensus-based).

## Database Tables (Convex)

`trades`, `positions`, `trackedTraders`, `traderActivity`, `copyTradeSignals`, `agentActions`, `markets`, `analytics`, `config`, `wallet`

## Cron Jobs

| Job | Interval | Function |
|-----|----------|----------|
| Autonomous agent cycle | 15 min | `runAgentCycle` |
| Copy-trade cycle | 10 min | `runCopyTradeCycle` |
| Trader leaderboard refresh | 6 hours | `refreshTrackedTraders` |
| Position price refresh | 5 min | `refreshPositions` |
| Daily analytics | Midnight UTC | `computeDailyAnalytics` |

## Environment Variables

Required:
```
NEXT_PUBLIC_CONVEX_URL=       # Convex deployment URL
OPENROUTER_API_KEY=           # For Grok 4.20 access
CONVEX_DEPLOYMENT=            # Convex deployment identifier
```

For live trading:
```
POLYMARKET_PRIVATE_KEY=       # Wallet private key
POLYMARKET_API_KEY=           # CLOB API key
POLYMARKET_API_SECRET=        # CLOB API secret
POLYMARKET_API_PASSPHRASE=    # CLOB API passphrase
POLYMARKET_FUNDER_ADDRESS=    # Optional, defaults to signer
```

Optional research tools:
```
FIRECRAWL_API_KEY=            # Web search
PERPLEXITY_API_KEY=           # Real-time Q&A
APIFY_API_TOKEN=              # Social sentiment
```

## Commands

```bash
npm run dev              # Start Next.js dev server
npx convex dev           # Start Convex backend (must run alongside dev)
npm run setup-wallet     # Generate wallet + derive API credentials
npm run seed-config      # Seed default config + initialize mock wallet
npm run derive-keys      # Derive CLOB API keys from private key
npm run build            # Production build
```

Both `npm run dev` and `npx convex dev` must be running simultaneously for the app to work.

## Key Design Decisions

- **Grok 4.20 Beta** for chat (tool calling support), **Grok 4.20 Multi-Agent Beta** for backend pipelines (no tool calling via OpenRouter)
- **Dry run mode** is ON by default — simulates trades without placing real orders
- **Consensus-based copy-trading** — requires 2+ top traders agreeing on the same market side before copying (or 1 trader with score > 0.8)
- **LLM validation layer** — Grok validates every copy-trade signal before execution to filter manipulation/noise
- **Risk manager** enforces min confidence (0.6), max trade size ($25), max exposure ($500), and min trade size ($0.50)
- **FOK orders** for autonomous trades, **GTC orders** for copy-trades
- All Convex mutations have internal variants for server-side use
- Chat uses `streamText` with `smoothStream({ chunking: "word" })` and `maxSteps: 5` for multi-tool chains

## TypeScript Notes

- Convex generated types in `convex/_generated/` must be regenerated with `npx convex dev` after schema changes
- The project uses path aliases: `@/src/*`, `@/components/*`, `@/convex/*`
- `zod` v4 requires `--legacy-peer-deps` on npm install due to OpenAI SDK peer dep conflict
- Chat UI uses `@ai-sdk/react` `useChat` hook with `sendMessage({ text })` pattern
- Streamdown component handles markdown rendering in streaming mode

## Known Issues

- Grok 4.20 Multi-Agent Beta does NOT support tool calling through OpenRouter — use Grok 4.20 Beta for any tool-calling features
- Polymarket Data API leaderboard endpoint requires `/v1/` prefix and specific param names (`timePeriod`, `orderBy`, `category`)
