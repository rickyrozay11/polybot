# Polymarket Copy-Trading Bot

Autonomous Polymarket trading bot focused on **short-term price trading** and **elite copy-trading**, powered by a multi-model ensemble via OpenRouter.

## Trading Philosophy

This bot **trades the price, not the outcome**. It buys when price momentum is favorable and exits via take-profit, stop-loss, or copy-exit — not by waiting for market resolution. Copy-trading is the primary strategy.

## Tech Stack

- **Frontend**: Next.js 15 (App Router, Turbopack), React 19, TailwindCSS
- **Backend**: Convex (real-time database + serverless functions)
- **LLM (Chat Fast)**: Grok 4.20 Beta via OpenRouter (`x-ai/grok-4.20-beta`) — tool calling
- **LLM (Chat Heavy)**: GPT-5.4 via OpenRouter (`openai/gpt-5.4`) — complex analysis
- **LLM (Agent Pipeline)**: Grok 4.20 Multi-Agent Beta (`x-ai/grok-4.20-multi-agent-beta`) — NO tool calling
- **LLM (Research/Tools)**: DeepSeek V3.2 (`deepseek/deepseek-v3.2`) — tool calling, cheapest
- **Markets**: Polymarket CLOB Client (Polygon, chain 137) + Gamma API
- **Data**: Polymarket Data API (leaderboard, trader activity, positions)
- **Streaming**: AI SDK v6 (`ai` + `@ai-sdk/react` + `@ai-sdk/openai-compatible`) with `streamText`, `stopWhen`, `useChat`

## Model Architecture

- **Chat route** (`app/api/chat/route.ts`) uses **multi-model routing**:
  - Fast queries (price checks, listings) → `x-ai/grok-4.20-beta`
  - Complex queries (analysis, strategy) → `openai/gpt-5.4`
  - Routing is automatic via keyword-based complexity classification
- **Agent pipeline** uses `x-ai/grok-4.20-multi-agent-beta` for screening/decisions (no tools)
- **Research stage** uses `deepseek/deepseek-v3.2` for tool-calling loops ($0.26/M input)
- **Ensemble voting** (4 models validate trades in parallel):
  - `deepseek/deepseek-v3.2` ($0.26/$0.38 — cheapest, IMO gold medal reasoning)
  - `google/gemini-3-flash-preview` ($0.50/$3 — near-Pro agentic reasoning)
  - `openai/gpt-5.4` ($2.50/$15 — strong general-purpose)
  - `anthropic/claude-sonnet-4-6` ($3/$15 — best agentic coding/reasoning)
  - All 4 support tool calling. Consensus: 3+ agree or 2+ with avg confidence > 0.7
- All models accessed through **single OpenRouter API key** for unified billing

## AI SDK v6 Notes

- `tool()` uses `inputSchema` (not `parameters`)
- `streamText` uses `stopWhen: stepCountIs(5)` (not `maxSteps: 5`)
- Import `stepCountIs` from `"ai"`
- LLMs sometimes return JSON wrapped in ` ```json ``` ` code fences even with `response_format: { type: "json_object" }` — always use `stripCodeFences()` before `JSON.parse`

## Project Structure

```
polybot/
├── app/                    # Next.js pages
│   ├── page.tsx            # Dashboard (KPIs, P&L chart, markets)
│   ├── chat/               # Chat interface
│   │   └── page.tsx        # Chat UI with Streamdown markdown rendering
│   ├── copy-trade/         # Copy-trading UI (traders, signals, activity)
│   │   └── page.tsx        # 3-tab view: Tracked Traders, Signals, Activity
│   ├── simulator/          # Bot simulator page
│   │   └── page.tsx        # Backtest and simulate strategies
│   ├── markets/            # Market browser + detail views
│   ├── positions/          # Open positions + trade history
│   ├── activity/           # Agent cycle history
│   ├── settings/           # Config + wallet management
│   └── api/chat/           # Streaming chat API route (5 Polymarket tools)
│       └── route.ts        # streamText + tools (inputSchema) + stopWhen
├── components/             # React components
│   ├── dashboard/          # KpiStrip, PnlAreaChart, MarketGrid, AgentFeed
│   ├── activity/           # CycleList, CycleCard, StageCard
│   ├── markets/            # MarketHero, OrderBookPanel, OutcomesTable
│   ├── nav/                # Sidebar navigation
│   ├── providers/          # ConvexProvider
│   └── ui/                 # Card, Button, Badge primitives
├── convex/                 # Convex backend
│   ├── schema.ts           # Database schema (13+ tables)
│   ├── agentRun.ts         # Agent cycles: autonomous + copy-trading + auto-exit
│   ├── trades.ts           # Trade CRUD
│   ├── positions.ts        # Position CRUD (with TP/SL/exitReason)
│   ├── trackedTraders.ts   # Tracked traders + signals + performance attribution
│   ├── agentActions.ts     # Pipeline action logging
│   ├── analytics.ts        # Daily/weekly performance metrics
│   ├── config.ts           # Key-value config store
│   ├── wallet.ts           # Mock/real wallet management (deduct/credit/reconcile)
│   ├── botSimulator.ts     # Bot simulation backend
│   ├── markets.ts          # Market data queries
│   └── crons.ts            # Scheduled jobs (5 crons)
├── src/
│   ├── agent/
│   │   ├── pipeline.ts     # 6-stage autonomous trading pipeline
│   │   ├── copy-trader.ts  # Copy-trading engine v2 (ROI scoring, exit detection)
│   │   ├── prompts.ts      # LLM prompts (price-trading focused)
│   │   ├── market-scorer.ts # Short-term market filtering (hours-to-days)
│   │   ├── risk-manager.ts # Risk checks (confidence, size, exposure)
│   │   ├── convergence-trader.ts  # CEX price lag detection
│   │   └── whale-tracker.ts       # $10K+ trade monitoring
│   ├── llm/
│   │   ├── openrouter.ts   # OpenRouter provider
│   │   ├── provider.ts     # Provider factory
│   │   ├── multi-model-provider.ts # Ensemble + ChatRouter + stripCodeFences
│   │   └── types.ts        # LLM interface types
│   ├── tools/
│   │   ├── polymarket-client.ts    # CLOB client (orders, orderbook)
│   │   ├── polymarket-scanner.ts   # Gamma API (trending markets)
│   │   ├── polymarket-data-api.ts  # Data API (leaderboard, activity, positions)
│   │   ├── tool-registry.ts        # LLM tool definitions + executor
│   │   ├── firecrawl-search.ts     # Web search
│   │   ├── perplexity-search.ts    # Real-time Q&A
│   │   ├── apify-scraper.ts        # Social sentiment
│   │   └── polymarket-ws.ts        # WebSocket client
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

## Trading Modes

### 1. Copy-Trading (PRIMARY — every 3 min)
Pipeline: Discover Top Traders → Scan Activity → Detect Exits → Generate Consensus Signals → Ensemble Validation → Execute with TP/SL

- **ROI-based scoring** (profit/volume), not raw PnL
- **Real win rate** calculated from actual trade history
- **Sharpe-like consistency** scoring
- **Exponential time decay** (7-day half-life) — stale traders drop off
- **Position-aware filtering** — skips signals where traders are averaging down
- **Copy-exit detection** — mirrors trader sells on your open positions
- **Per-trader P&L attribution** — tracks your actual return from each trader
- **Auto-disable underperformers** — drops traders with <30% copy win rate

### 2. Autonomous Research Trading (every 10 min)
Pipeline: Scan → Filter → LLM Screen → Deep Research (tools via DeepSeek) → Trade Decision → Risk Check → Execute

Focuses on short-term price movements, not long-term resolution bets.

### 3. Auto-Exit System (every 2 min)
- **Take profit**: 12% gain → auto-sell
- **Stop loss**: 10% loss → auto-cut
- **Time stop**: 3-day max hold
- **Copy exit**: mirrors when tracked trader sells

### 4. CEX Convergence Trading
Detects price lag between Binance/Coinbase and Polymarket prediction markets.

### 5. Whale Tracking ($10K+ Trades)
Monitors for large trades, volume spikes, and potential insider activity.

## Copy-Trader v2 Scoring Weights

| Factor | Weight | Description |
|--------|--------|-------------|
| ROI | 30% | Profit / volume (capital efficiency) |
| Real Win Rate | 25% | Actual wins from trade history |
| Consistency | 20% | Sharpe-like: mean return / stddev |
| Volume | 10% | Proves conviction (log-normalized) |
| Recency | 15% | 7d ranking matters most |

All scores get exponential time decay (half-life: 7 days of inactivity).

## Market Scoring (Short-Term Focus)

- Favors markets resolving in **hours to 3 days** (peak at ~24 hours)
- Filters out markets > 14 days away
- Minimum 2 hours to resolution (avoids last-second illiquidity)
- Lower volume threshold ($5K) for short-term markets
- Scores near-certain outcomes (>85% or <15%) as high-edge if close to resolution

## Cron Jobs

| Job | Interval | Function |
|-----|----------|----------|
| Autonomous agent cycle | 10 min | `runAgentCycle` |
| Copy-trade cycle | 3 min | `runCopyTradeCycle` |
| Trader leaderboard refresh | 4 hours | `refreshTrackedTraders` |
| Position refresh + auto-exit | 2 min | `refreshPositions` |
| Daily analytics | Midnight UTC | `computeDailyAnalytics` |

## Database Tables (Convex)

`trades`, `positions` (with TP/SL/copiedFrom), `trackedTraders` (with ROI/consistency/copyPnl), `traderActivity`, `traderPerformance`, `copyTradeSignals`, `agentActions`, `markets`, `analytics`, `config`, `wallet`, `ensembleVotes`, `whaleAlerts`, `convergenceSignals`

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

## Environment Variables

Required:
```
NEXT_PUBLIC_CONVEX_URL=       # Convex deployment URL
OPENROUTER_API_KEY=           # For all LLM access (single key)
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

- **Price trading, not resolution betting** — buy low, sell high, don't hold to expiry
- **Copy-trading is primary** — 3-min scan cycle, exit mirroring, per-trader P&L tracking
- **Auto-exit system** — TP (12%), SL (10%), 3-day time stop, copy-exit
- **DeepSeek V3.2 for research** — $0.26/M input, supports tools, IMO gold medal reasoning
- **Grok Multi-Agent for non-tool tasks** — screening, decisions (no tool calling on OpenRouter)
- **4-model ensemble** — all support tools, diverse architectures, cost-optimized
- **Dry run mode** ON by default — simulates trades without real orders
- **stripCodeFences()** — always strip markdown fences before JSON.parse (LLMs ignore response_format)
- **Risk manager** enforces min confidence (0.55), max trade size ($25), max exposure ($500)
- **FOK orders** for autonomous trades, **GTC orders** for copy-trades
- All Convex mutations have internal variants for server-side use

## TypeScript Notes

- Convex generated types in `convex/_generated/` must be regenerated with `npx convex dev` or `npx convex codegen` after schema changes
- The project uses path aliases: `@/src/*`, `@/components/*`, `@/convex/*`
- AI SDK v6: `tool()` uses `inputSchema` not `parameters`, `stopWhen` not `maxSteps`
- Chat UI uses `@ai-sdk/react` `useChat` hook with `sendMessage({ text })` pattern

## Known Issues

- Grok 4.20 Multi-Agent Beta does NOT support tool calling through OpenRouter — use DeepSeek V3.2 or other tool-capable model for research
- Polymarket Data API leaderboard endpoint requires `/v1/` prefix and specific param names (`timePeriod`, `orderBy`, `category`)
- LLMs return markdown-wrapped JSON even with `response_format: { type: "json_object" }` — always use `stripCodeFences()` before `JSON.parse`
- GPT-5.4, Gemini 3 Flash, and DeepSeek V3.2 availability depends on OpenRouter — check their status page if ensemble votes fail
