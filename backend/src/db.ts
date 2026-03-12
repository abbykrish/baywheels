import path from "path";
import { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";

const DB_PATH =
  process.env.BAYWHEELS_DB ??
  path.resolve(import.meta.dirname, "..", "..", "data", "baywheels.duckdb");

let instance: DuckDBInstance | null = null;
let persistentConn: DuckDBConnection | null = null;

/** Get a shared persistent connection (avoids per-query connection overhead). */
export async function getConnection(): Promise<DuckDBConnection> {
  if (!instance) {
    instance = await DuckDBInstance.create(DB_PATH);
    const setup = await instance.connect();
    await setup.run("SET memory_limit = '512MB'");
    setup.closeSync();
  }
  if (!persistentConn) {
    persistentConn = await instance.connect();
  }
  return persistentConn;
}

/** Run a read-only query and return row objects. */
export async function query(sql: string): Promise<Record<string, unknown>[]> {
  const conn = await getConnection();
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson();
}

/** Rebuild precomputed summary tables from raw trips. */
export async function refreshSummaries(): Promise<void> {
  const conn = await getConnection();
  console.log("Refreshing summary tables...");

  await conn.run(`
    CREATE OR REPLACE TABLE monthly_stats AS
    SELECT
      date_trunc('month', started_at)::DATE AS month,
      count(*) AS total_trips,
      sum(epoch(ended_at - started_at)) AS duration_sum_sec,
      count(*) AS duration_count,
      count(DISTINCT date_trunc('day', started_at)) AS active_days,
      sum(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) AS member_trips,
      sum(CASE WHEN member_casual = 'casual' THEN 1 ELSE 0 END) AS casual_trips
    FROM trips
    GROUP BY month
  `);

  await conn.run(`
    CREATE OR REPLACE TABLE monthly_hourly AS
    SELECT
      date_trunc('month', started_at)::DATE AS month,
      extract('hour' FROM started_at)::INT AS hour,
      count(*) AS trips,
      sum(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) AS member_trips,
      sum(CASE WHEN member_casual = 'casual' THEN 1 ELSE 0 END) AS casual_trips
    FROM trips
    GROUP BY month, hour
  `);

  await conn.run(`
    CREATE OR REPLACE TABLE monthly_stations AS
    SELECT
      date_trunc('month', started_at)::DATE AS month,
      start_station_name,
      start_station_id,
      round(avg(start_lat), 5) AS lat,
      round(avg(start_lng), 5) AS lng,
      count(*) AS departures
    FROM trips
    WHERE start_station_name IS NOT NULL AND start_station_name != ''
      AND start_lat IS NOT NULL
    GROUP BY month, start_station_name, start_station_id
  `);

  await conn.run(`
    CREATE OR REPLACE TABLE monthly_flows AS
    SELECT
      date_trunc('month', started_at)::DATE AS month,
      start_station_name,
      end_station_name,
      round(avg(start_lat), 5) AS start_lat,
      round(avg(start_lng), 5) AS start_lng,
      round(avg(end_lat), 5) AS end_lat,
      round(avg(end_lng), 5) AS end_lng,
      count(*) AS trip_count
    FROM trips
    WHERE start_station_name IS NOT NULL AND start_station_name != ''
      AND end_station_name IS NOT NULL AND end_station_name != ''
      AND start_station_name != end_station_name
      AND start_lat IS NOT NULL AND end_lat IS NOT NULL
    GROUP BY month, start_station_name, end_station_name
  `);

  await conn.run(`
    CREATE OR REPLACE TABLE daily_trips AS
    SELECT
      cast(date_trunc('day', started_at) AS DATE) AS day,
      count(*) AS trips
    FROM trips
    GROUP BY day
    ORDER BY day
  `);

  await conn.run(`
    CREATE OR REPLACE TABLE station_names AS
    SELECT DISTINCT start_station_name
    FROM trips
    WHERE start_station_name IS NOT NULL AND start_station_name != ''
    ORDER BY start_station_name
  `);

  console.log("Summary tables refreshed.");
}

export { DB_PATH };
