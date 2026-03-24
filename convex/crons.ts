import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Autonomous trading cycle (research-based)
crons.interval(
  "agent-cycle",
  { minutes: 10 },
  internal.agentRun.runAgentCycle
);

// Copy-trading cycle — scan top traders and mirror their trades
// Runs every 3 minutes for fast reaction to trader activity
crons.interval(
  "copy-trade-cycle",
  { minutes: 3 },
  internal.agentRun.runCopyTradeCycle
);

// Refresh tracked traders from leaderboard (every 4 hours)
crons.cron(
  "refresh-tracked-traders",
  "0 */4 * * *",
  internal.agentRun.refreshTrackedTraders
);

// Position price refresh + auto-exit (TP/SL) check
// Runs every 2 minutes to catch exit targets quickly
crons.interval(
  "position-refresh",
  { minutes: 2 },
  internal.agentRun.refreshPositions
);

// Daily analytics snapshot
crons.cron(
  "daily-analytics",
  "0 0 * * *",
  internal.agentRun.computeDailyAnalytics
);

export default crons;
