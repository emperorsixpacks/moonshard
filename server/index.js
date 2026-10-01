import { config } from "./config.js";
import { createDb } from "./src/db.js";
import { createChain } from "./src/chain.js";
import { createApp } from "./src/app.js";
import { startSettlementCron } from "./src/cron.js";

if (!config.jwtSecret) {
  console.error("[moonshard] JWT_SECRET is required");
  process.exit(1);
}

const db = await createDb(config.databaseUrl);
const chain = createChain(config);
const { app, ctx } = createApp({ db, chain, config });

app.listen(config.port, "0.0.0.0", () => {
  console.log(`[moonshard] API on :${config.port} (chain ${config.chainId}, db ${config.databaseUrl ? "postgres" : "in-memory"})`);
});
startSettlementCron(ctx);
