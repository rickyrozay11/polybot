// ============================================================
// Shared TypeScript types for the Polymarket Trading Bot
// ============================================================

// --- LLM Types ---

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: LLMToolCall[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface LLMProvider {
  chat(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };
  }): Promise<LLMResponse>;
}

// --- Market Types ---

export interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  markets: PolymarketMarket[];
  volume: number;
  liquidity: number;
  endDate: string;
  active: boolean;
}

export interface PolymarketMarket {
  condition_id: string;
  question: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
  volume: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  slug: string;
  image: string;
  icon: string;
  neg_risk: boolean;
  description: string;
}

export interface OrderbookSummary {
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  midpoint: number;
  bidDepth: number;
  askDepth: number;
}

// --- Agent Types ---

export type AgentActionType =
  | "scan"
  | "filter"
  | "screen"
  | "research"
  | "trade"
  | "position_refresh"
  | "copy_trade_scan"
  | "copy_trade_execute"
  | "whale_alert"
  | "convergence_signal"
  | "ensemble_vote"
  | "error";

// --- Copy-Trading Types ---

export interface TrackedTrader {
  address: string;
  username: string;
  pnl: number;
  volume: number;
  winRate: number;
  tradeCount: number;
  compositeScore: number;
  lastUpdated: number;
}

export interface TraderPosition {
  conditionId: string;
  question: string;
  tokenId: string;
  side: "yes" | "no";
  size: number;
  price: number;
  timestamp: number;
}

export interface CopyTradeSignal {
  traderAddress: string;
  traderUsername: string;
  traderScore: number;
  conditionId: string;
  question: string;
  tokenId: string;
  side: "buy_yes" | "buy_no";
  traderSize: number;
  suggestedSize: number;
  price: number;
  consensus: number; // 0-1 how many tracked traders agree
  reasoning: string;
}

export interface AgentAction {
  type: AgentActionType;
  summary: string;
  details: Record<string, unknown>;
  timestamp: number;
}

export interface MarketCandidate {
  conditionId: string;
  question: string;
  slug: string;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  volume: number;
  liquidity: number;
  endDate: string;
  negRisk: boolean;
}

export interface ScreeningResult {
  conditionId: string;
  question: string;
  preliminaryConfidence: number;
  reasoning: string;
}

export interface ResearchReport {
  conditionId: string;
  question: string;
  webSearchResults: string;
  socialSentiment: string;
  perplexityAnalysis: string;
  orderbookAnalysis: OrderbookSummary;
}

export interface TradeDecision {
  conditionId: string;
  question: string;
  action: "buy_yes" | "buy_no" | "skip";
  tokenId: string;
  confidence: number;
  reasoning: string;
  suggestedSize: number;
  suggestedPrice: number;
}

export interface RiskCheckResult {
  approved: boolean;
  reason?: string;
  adjustedSize?: number;
}

// --- Research Tool Results ---

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SocialSentimentResult {
  platform: string;
  postCount: number;
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  summary: string;
  topPosts: Array<{ text: string; engagement: number }>;
}

export interface PerplexityResult {
  answer: string;
  sources: string[];
}

// --- Config Types ---

export interface AgentConfig {
  maxTradeSize: number;
  maxTotalExposure: number;
  minConfidence: number;
  modelId: string;
  ensembleModels?: string[];
  runIntervalMinutes: number;
  enabled: boolean;
  dryRun: boolean;
  availableBalance: number;
}

export const DEFAULT_CONFIG: AgentConfig = {
  maxTradeSize: 25,
  maxTotalExposure: 500,
  minConfidence: 0.6,
  modelId: "x-ai/grok-4.20-multi-agent-beta",
  ensembleModels: [
    "x-ai/grok-4.20-multi-agent-beta",
    "anthropic/claude-opus-4-6",
    "openai/gpt-5.4",
    "deepseek/deepseek-v3.2",
  ],
  runIntervalMinutes: 15,
  enabled: true,
  dryRun: true,
  availableBalance: 500,
};

// --- Ensemble Types ---

export interface EnsembleVote {
  modelId: string;
  response: LLMResponse;
  latencyMs: number;
  parsedAction?: string;
  parsedConfidence?: number;
}

export interface EnsembleResult {
  votes: EnsembleVote[];
  consensus: {
    action: "buy_yes" | "buy_no" | "skip";
    confidence: number;
    agreementLevel: "full" | "majority" | "weak" | "none";
    voteCounts: Record<string, number>;
  };
}

// --- Whale Tracking Types ---

export interface WhaleTradeAlert {
  traderAddress: string;
  conditionId: string;
  question: string;
  tokenId: string;
  side: "buy_yes" | "buy_no";
  size: number;
  price: number;
  timestamp: number;
  totalValue: number;
  isInsider: boolean;
  marketSlug?: string;
}

export interface VolumeSpike {
  conditionId: string;
  question: string;
  normalVolume: number;
  currentVolume: number;
  spikeMultiplier: number;
  timestamp: number;
  direction: "bullish" | "bearish" | "mixed";
}

// --- Convergence Trading Types ---

export interface ConvergenceSignal {
  conditionId: string;
  question: string;
  tokenId: string;
  side: "buy_yes" | "buy_no";
  confidence: number;
  reasoning: string;
  cexPrice: number;
  polymarketPrice: number;
  expectedPolyPrice: number;
  priceLagPercent: number;
  suggestedSize: number;
  exchange: string;
  symbol: string;
}

export interface CryptoMarketMapping {
  symbol: string;
  conditionId: string;
  question: string;
  tokenId: string;
  threshold: number;
  direction: "above" | "below";
}

// --- WebSocket Types ---

export interface PriceUpdate {
  tokenId: string;
  oldPrice: number;
  newPrice: number;
  timestamp: number;
  volume?: number;
}

export interface WSTradeEvent {
  tokenId: string;
  side: string;
  size: number;
  price: number;
  timestamp: number;
  maker?: string;
  taker?: string;
}
