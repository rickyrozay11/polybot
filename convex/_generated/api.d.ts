/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentActions from "../agentActions.js";
import type * as agentRun from "../agentRun.js";
import type * as analytics from "../analytics.js";
import type * as botSimulator from "../botSimulator.js";
import type * as config from "../config.js";
import type * as crons from "../crons.js";
import type * as markets from "../markets.js";
import type * as positions from "../positions.js";
import type * as trackedTraders from "../trackedTraders.js";
import type * as trades from "../trades.js";
import type * as wallet from "../wallet.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentActions: typeof agentActions;
  agentRun: typeof agentRun;
  analytics: typeof analytics;
  botSimulator: typeof botSimulator;
  config: typeof config;
  crons: typeof crons;
  markets: typeof markets;
  positions: typeof positions;
  trackedTraders: typeof trackedTraders;
  trades: typeof trades;
  wallet: typeof wallet;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
