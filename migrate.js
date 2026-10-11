// Applies migrations/*.sql in name order, once each. Run: bun run migrate
import { sql } from "./src/services/db.js";
import { readdir } from "node:fs/promises";

await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));

for (const name of (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort()) {
	if (applied.has(name)) continue;
	await sql.begin(async (tx) => {
		await tx.unsafe(await Bun.file(`migrations/${name}`).text());
		await tx`insert into schema_migrations (name) values (${name})`;
	});
	console.log(`applied ${name}`);
}
await sql.close();
