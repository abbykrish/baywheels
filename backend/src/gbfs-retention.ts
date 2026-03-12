import { getConnection } from "./db.js";

// ─── Hourly rollup table ─────────────────────────────────────────────────────

export async function ensureRetentionTables(): Promise<void> {
  const conn = await getConnection();

  await conn.run(`
    CREATE TABLE IF NOT EXISTS gbfs_station_hourly (
      hour_ts TIMESTAMP,
      station_id VARCHAR,
      avg_bikes_available DOUBLE,
      avg_ebikes_available DOUBLE,
      avg_docks_available DOUBLE,
      min_ebikes_available INTEGER,
      max_ebikes_available INTEGER,
      minutes_at_zero_ebikes DOUBLE,
      sample_count INTEGER
    )
  `);
}

// ─── Retention policy ────────────────────────────────────────────────────────

let lastRetentionRun: string | null = null;

export async function runRetentionIfNeeded(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastRetentionRun === today) return;

  console.log("Running GBFS data retention...");
  const conn = await getConnection();

  await ensureRetentionTables();

  // Aggregate station snapshots older than 7 days into hourly rollups
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  await conn.run(`
    INSERT INTO gbfs_station_hourly
    SELECT
      date_trunc('hour', snapshot_ts) AS hour_ts,
      station_id,
      avg(num_bikes_available) AS avg_bikes_available,
      avg(num_ebikes_available) AS avg_ebikes_available,
      avg(num_docks_available) AS avg_docks_available,
      min(num_ebikes_available) AS min_ebikes_available,
      max(num_ebikes_available) AS max_ebikes_available,
      sum(CASE WHEN num_ebikes_available = 0 THEN 5.0 ELSE 0.0 END) AS minutes_at_zero_ebikes,
      count(*) AS sample_count
    FROM gbfs_station_snapshots
    WHERE snapshot_ts < '${cutoff7d}'
      AND date_trunc('hour', snapshot_ts) NOT IN (
        SELECT DISTINCT hour_ts FROM gbfs_station_hourly
      )
    GROUP BY hour_ts, station_id
  `);

  // Delete old raw snapshots
  await conn.run(`
    DELETE FROM gbfs_station_snapshots
    WHERE snapshot_ts < '${cutoff7d}'
  `);

  // Delete free bikes older than 24 hours
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  await conn.run(`
    DELETE FROM gbfs_free_bikes
    WHERE snapshot_ts < '${cutoff24h}'
  `);

  lastRetentionRun = today;
  console.log("GBFS retention completed.");
}
