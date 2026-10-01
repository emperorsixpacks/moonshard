import { config } from "./config.js";
import { assertSecureConfig } from "./src/boot.js";
import { createDb } from "./src/db.js";
import { createChain } from "./src/chain.js";
import { createApp } from "./src/app.js";
import { startSettlementCron } from "./src/cron.js";

try {
  assertSecureConfig(config);
} catch (err) {
  console.error(`[moonshard] refusing to start: ${err.message}`);
  process.exit(1);
}

const db = await createDb(config.databaseUrl);
const chain = createChain(config);
const { app, ctx } = createApp({ db, chain, config });

app.listen(config.port, "0.0.0.0", () => {
  console.log(`[moonshard] API on :${config.port} (chain ${config.chainId}, db ${config.databaseUrl ? "postgres" : "in-memory"})`);
});
startSettlementCron(ctx);
