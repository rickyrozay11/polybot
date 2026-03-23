import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const defaults: Record<string, string> = {
  maxTradeSize: "25",
  maxTotalExposure: "500",
  minConfidence: "0.6",
  modelId: "x-ai/grok-4.20-multi-agent-beta",
  runIntervalMinutes: "15",
  enabled: "true",
  dryRun: "true",
};

async function main() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    console.error("NEXT_PUBLIC_CONVEX_URL env variable is required");
    process.exit(1);
  }

  const client = new ConvexHttpClient(url);

  console.log("Seeding default config values...\n");

  for (const [key, value] of Object.entries(defaults)) {
    await client.mutation(api.config.setConfig, { key, value });
    console.log(`  ${key} = ${value}`);
  }

  // Initialize mock wallet with $500
  const INITIAL_BALANCE = 500;
  await client.mutation(api.wallet.initWallet, { initialBalance: INITIAL_BALANCE });
  console.log(`\n  wallet = $${INITIAL_BALANCE} (mock balance)`);

  console.log("\nDone. Config and wallet seeded successfully.");
}

main().catch((err) => {
  console.error("Failed to seed config:", err);
  process.exit(1);
});
