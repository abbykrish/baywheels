/**
 * Diagnostic: show distinct rideable_type values and member_casual values
 * in the trips table for the 12-month rolling window.
 *
 * Stop the backend first (it holds an exclusive lock on the DuckDB file),
 * then run: npx tsx src/diagnose-trips.ts
 */

import { query } from "./db.js";

async function main() {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  console.log(`Window: >= ${cutoff}\n`);

  const range = await query(`
    SELECT min(started_at) AS earliest, max(started_at) AS latest, count(*) AS total
    FROM trips
    WHERE started_at >= '${cutoff}'
  `);
  console.log("Range:", range[0]);

  const byType = await query(`
    SELECT rideable_type, count(*) AS n
    FROM trips
    WHERE started_at >= '${cutoff}'
    GROUP BY rideable_type
    ORDER BY n DESC
  `);
  console.log("\nrideable_type breakdown:");
  byType.forEach((r) => console.log(`  ${r.rideable_type ?? "(NULL)"}: ${Number(r.n).toLocaleString()}`));

  const byMember = await query(`
    SELECT member_casual, count(*) AS n
    FROM trips
    WHERE started_at >= '${cutoff}'
    GROUP BY member_casual
    ORDER BY n DESC
  `);
  console.log("\nmember_casual breakdown:");
  byMember.forEach((r) => console.log(`  ${r.member_casual ?? "(NULL)"}: ${Number(r.n).toLocaleString()}`));

  const combo = await query(`
    SELECT rideable_type, member_casual, count(*) AS n
    FROM trips
    WHERE started_at >= '${cutoff}'
    GROUP BY rideable_type, member_casual
    ORDER BY rideable_type, n DESC
  `);
  console.log("\nrideable_type × member_casual:");
  combo.forEach((r) => console.log(`  ${r.rideable_type ?? "(NULL)"} / ${r.member_casual ?? "(NULL)"}: ${Number(r.n).toLocaleString()}`));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
