// CLI: process one paper end-to-end without the web server.
//   npx tsx scripts/import-paper.ts 9702 2022 s 12
import "../server/config";
import { db } from "../server/db";
import { seedCatalog } from "../server/catalog";
import { upsertPaper } from "../server/pipeline/queue";
import { processPaper } from "../server/pipeline/run";

const [code, year, session, component] = process.argv.slice(2);
if (!component) { console.error("usage: import-paper <code> <year> <m|s|w> <component>"); process.exit(1); }
seedCatalog();
const id = upsertPaper(code, Number(year), session, component);
db.prepare("UPDATE papers SET stage='download' WHERE id=?").run(id);
await processPaper(id);
console.log(db.prepare("SELECT id,type,status,question_count,review_count FROM papers WHERE id=?").get(id));
console.log(db.prepare("SELECT status, display, COUNT(*) n FROM questions WHERE paper_id=? GROUP BY 1,2").all(id));
console.log(db.prepare("SELECT ROUND(SUM(cost_usd),4) usd, SUM(input_tokens) inp, SUM(output_tokens) out FROM ai_usage WHERE paper_id=?").get(id));
for (const l of db.prepare("SELECT level,message FROM job_logs WHERE paper_id=? ORDER BY id").all(id) as any[]) console.log(`  [${l.level}] ${l.message}`);
