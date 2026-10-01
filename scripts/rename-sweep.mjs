import fs from "node:fs";
import path from "node:path";

// Ordered: longer / more specific phrases first so shorter ones do not clobber them.
const PAIRS = [
  ["LUNA_BLADE_SAVE_V1", "MOONSHARD_SAVE_V1"],
  ["LUNA BLADE", "MOONSHARD"],
  ["Luna Blade", "Moonshard"],
  ["luna-blade", "moonshard"],
  ["luna_blade", "moonshard"],
  ["LUNA HARVEST", "SHARD HARVEST"],
  ["Luna Harvest", "Shard Harvest"],
  ["LUNA CRYSTALS", "SHARDS"],
  ["Luna Crystals", "Shards"],
  ["Luna Crystal", "Shard"],
  ["LUNA CRYSTAL", "SHARD"],
  ["LUNA_CRYSTAL", "SHARD"],
  ["luna_crystal", "shard"],
  ["LunaCrystalCollected", "ShardCollected"],
  ["LunaCrystalDrop", "ShardDrop"],
  ["lunaCrystalRewardNim", "shardRewardGd"],
  ["lunaCrystalDailyCapNim", "dailyShardCapGd"],
  ["lunaCrystals", "shardDrops"],
  ["Daily Luna Trial", "Daily Shard Trial"],
  ["DAILY LUNA TRIAL", "DAILY SHARD TRIAL"],
  ["Luna Trial", "Shard Trial"],
  ["LUNA TRIAL", "SHARD TRIAL"],
  ["luna-inset", "ms-inset"],
  ["luna-toast", "ms-toast"],
  ["luna-safe", "ms-safe"],
];

const ROOTS = ["src", "index.html"];
const EXT = new Set([".js", ".css", ".html"]);
let changedFiles = 0;

function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return fs.readdirSync(p).flatMap((f) => walk(path.join(p, f)));
  return EXT.has(path.extname(p)) ? [p] : [];
}

for (const file of ROOTS.flatMap(walk)) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of PAIRS) after = after.split(from).join(to);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changedFiles++;
  }
}
console.log(`rename-sweep: updated ${changedFiles} files`);
