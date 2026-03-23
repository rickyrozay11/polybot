import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Original agent cycle (autonomous trading)
crons.interval(
  "agent-cycle",
  { minutes: 15 },
  internal.agentRun.runAgentCycle
);

// Copy-trading cycle — scan top traders and mirror their trades
crons.interval(
  "copy-trade-cycle",
  { minutes: 10 },
  internal.agentRun.runCopyTradeCycle
);

// Refresh tracked traders from leaderboard (every 6 hours)
crons.cron(
  "refresh-tracked-traders",
  "0 */6 * * *",
  internal.agentRun.refreshTrackedTraders
);

// Position price refresh
crons.interval(
  "position-refresh",
  { minutes: 5 },
  internal.agentRun.refreshPositions
);

// Daily analytics snapshot
crons.cron(
  "daily-analytics",
  "0 0 * * *",
  internal.agentRun.computeDailyAnalytics
);

export default crons;
