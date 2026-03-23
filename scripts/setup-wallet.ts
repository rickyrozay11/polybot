/**
 * Wallet Setup Helper
 *
 * Generates a new Ethereum wallet for Polymarket trading,
 * derives the CLOB API credentials, and outputs a .env.local template.
 *
 * Usage:
 *   npx tsx scripts/setup-wallet.ts
 *   npx tsx scripts/setup-wallet.ts --private-key 0x...  (import existing)
 */

import { Wallet } from "ethers";

async function main() {
  const args = process.argv.slice(2);
  const importKeyIndex = args.indexOf("--private-key");

  let wallet: Wallet;

  if (importKeyIndex !== -1 && args[importKeyIndex + 1]) {
    // Import existing private key
    const pk = args[importKeyIndex + 1];
    wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`);
    console.log("\n  Imported existing wallet.\n");
  } else {
    // Generate new wallet
    wallet = Wallet.createRandom();
    console.log("\n  Generated a new wallet.\n");
    console.log("  ============================================");
    console.log("  SAVE YOUR MNEMONIC PHRASE (write it down!):");
    console.log(`  ${wallet.mnemonic?.phrase}`);
    console.log("  ============================================\n");
  }

  console.log(`  Address:     ${wallet.address}`);
  console.log(`  Private Key: ${wallet.privateKey}\n`);

  // Derive API credentials
  console.log("  Deriving Polymarket CLOB API credentials...\n");

  try {
    const { ClobClient } = await import("@polymarket/clob-client");
    const client = new ClobClient("https://clob.polymarket.com", 137, wallet);
    const creds: any = await client.createOrDeriveApiKey();

    console.log("  API Credentials derived successfully!\n");
    console.log("  ============================================");
    console.log("  Add the following to your .env.local file:");
    console.log("  ============================================\n");
    console.log(`  POLYMARKET_PRIVATE_KEY=${wallet.privateKey}`);
    console.log(`  POLYMARKET_API_KEY=${creds.apiKey ?? creds.key}`);
    console.log(`  POLYMARKET_API_SECRET=${creds.secret}`);
    console.log(`  POLYMARKET_API_PASSPHRASE=${creds.passphrase}`);
    console.log(`  POLYMARKET_FUNDER_ADDRESS=${wallet.address}`);
    console.log("");
    console.log("  # LLM & Backend");
    console.log("  OPENROUTER_API_KEY=your-openrouter-api-key-here");
    console.log("  CONVEX_DEPLOYMENT=your-convex-deployment-here");
    console.log("  NEXT_PUBLIC_CONVEX_URL=your-convex-url-here");
    console.log("");
    console.log("  # Optional research tools");
    console.log("  FIRECRAWL_API_KEY=your-firecrawl-key-here");
    console.log("  PERPLEXITY_API_KEY=your-perplexity-key-here");
    console.log("  APIFY_API_TOKEN=your-apify-token-here");
    console.log("");
  } catch (err) {
    console.log("  Could not derive API credentials automatically.");
    console.log("  This is normal if you haven't registered on Polymarket yet.\n");
    console.log("  Steps:");
    console.log("  1. Fund this wallet with MATIC on Polygon");
    console.log("  2. Deposit USDC into Polymarket at polymarket.com");
    console.log("  3. Run this script again to derive API credentials\n");
    console.log("  Your .env.local template:\n");
    console.log(`  POLYMARKET_PRIVATE_KEY=${wallet.privateKey}`);
    console.log("  POLYMARKET_API_KEY=");
    console.log("  POLYMARKET_API_SECRET=");
    console.log("  POLYMARKET_API_PASSPHRASE=");
    console.log(`  POLYMARKET_FUNDER_ADDRESS=${wallet.address}`);
    console.log("  OPENROUTER_API_KEY=your-openrouter-api-key-here");
    console.log("  CONVEX_DEPLOYMENT=your-convex-deployment-here");
    console.log("  NEXT_PUBLIC_CONVEX_URL=your-convex-url-here");
    console.log("");
  }

  console.log("  IMPORTANT: Never share your private key or mnemonic phrase!\n");
}

main().catch(console.error);
