import path from "path";
import fs from "fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConnection } from "./db.js";

const app = new Hono();
app.use("/api/*", cors());

/** Run a read-only query and return row objects. */
async function query(sql: string): Promise<Record<string, unknown>[]> {
  const conn = await getConnection();
  try {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  } finally {
    conn.closeSync();
  }
}

/** Build a WHERE clause fragment for optional date range. */
function dateFilter(start?: string, end?: string): string {
  const clauses: string[] = [];
  if (start) clauses.push(`started_at >= '${start}'`);
  if (end) clauses.push(`started_at < '${end}'`);
  return clauses.length ? clauses.join(" AND ") : "1=1";
}

// ─── /api/stats ──────────────────────────────────────────────────────────────
app.get("/api/stats", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const df = dateFilter(start, end);

  const [stats] = await query(`
    SELECT
      count(*)                                             AS total_trips,
      count(DISTINCT start_station_id)                     AS active_stations,
      round(avg(epoch(ended_at - started_at)) / 60, 1)    AS avg_duration_min,
      count(DISTINCT date_trunc('day', started_at))        AS active_days,
      sum(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) AS member_trips,
      sum(CASE WHEN member_casual = 'casual' THEN 1 ELSE 0 END) AS casual_trips
    FROM trips
    WHERE ${df}
  `);

  const [busiest] = await query(`
    SELECT start_station_name, count(*) AS cnt
    FROM trips
    WHERE start_station_name IS NOT NULL AND start_station_name != '' AND ${df}
    GROUP BY start_station_name
    ORDER BY cnt DESC
    LIMIT 1
  `);

  const [peak] = await query(`
    SELECT extract('hour' FROM started_at) AS hr, count(*) AS cnt
    FROM trips
    WHERE ${df}
    GROUP BY hr
    ORDER BY cnt DESC
    LIMIT 1
  `);

  return c.json({
    total_trips: Number(stats.total_trips),
    active_stations: Number(stats.active_stations),
    avg_duration_min: Number(stats.avg_duration_min ?? 0),
    active_days: Number(stats.active_days),
    member_trips: Number(stats.member_trips),
    casual_trips: Number(stats.casual_trips),
    busiest_station: busiest?.start_station_name ?? null,
    busiest_station_trips: Number(busiest?.cnt ?? 0),
    peak_hour: peak?.hr != null ? Number(peak.hr) : null,
  });
});

// ─── /api/flows ──────────────────────────────────────────────────────────────
app.get("/api/flows", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limit = Number(c.req.query("limit") ?? 200);
  const df = dateFilter(start, end);

  const rows = await query(`
    SELECT
      start_station_name,
      end_station_name,
      round(avg(start_lat), 5) AS start_lat,
      round(avg(start_lng), 5) AS start_lng,
      round(avg(end_lat), 5)   AS end_lat,
      round(avg(end_lng), 5)   AS end_lng,
      count(*)                 AS trip_count
    FROM trips
    WHERE start_station_name IS NOT NULL AND start_station_name != ''
      AND end_station_name IS NOT NULL AND end_station_name != ''
      AND start_station_name != end_station_name
      AND start_lat IS NOT NULL AND end_lat IS NOT NULL
      AND ${df}
    GROUP BY start_station_name, end_station_name
    ORDER BY trip_count DESC
    LIMIT ${limit}
  `);

  return c.json(
    rows.map((r) => ({
      from_name: r.start_station_name,
      to_name: r.end_station_name,
      from: [Number(r.start_lng), Number(r.start_lat)],
      to: [Number(r.end_lng), Number(r.end_lat)],
      count: Number(r.trip_count),
    }))
  );
});

// ─── /api/stations ───────────────────────────────────────────────────────────
app.get("/api/stations", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const df = dateFilter(start, end);

  const rows = await query(`
    SELECT
      start_station_name,
      start_station_id,
      round(avg(start_lat), 5) AS lat,
      round(avg(start_lng), 5) AS lng,
      count(*)                 AS departures
    FROM trips
    WHERE start_station_name IS NOT NULL AND start_station_name != ''
      AND start_lat IS NOT NULL
      AND ${df}
    GROUP BY start_station_name, start_station_id
    ORDER BY departures DESC
  `);

  return c.json(
    rows.map((r) => ({
      name: r.start_station_name,
      id: r.start_station_id,
      position: [Number(r.lng), Number(r.lat)],
      departures: Number(r.departures),
    }))
  );
});

// ─── /api/hourly ─────────────────────────────────────────────────────────────
app.get("/api/hourly", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const df = dateFilter(start, end);

  const rows = await query(`
    SELECT
      extract('hour' FROM started_at) AS hour,
      count(*) AS trips,
      sum(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) AS member_trips,
      sum(CASE WHEN member_casual = 'casual' THEN 1 ELSE 0 END) AS casual_trips
    FROM trips
    WHERE ${df}
    GROUP BY hour
    ORDER BY hour
  `);

  return c.json(
    rows.map((r) => ({
      hour: Number(r.hour),
      trips: Number(r.trips),
      member: Number(r.member_trips),
      casual: Number(r.casual_trips),
    }))
  );
});

// ─── /api/daily ──────────────────────────────────────────────────────────────
app.get("/api/daily", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const df = dateFilter(start, end);

  const rows = await query(`
    SELECT
      cast(date_trunc('day', started_at) AS DATE) AS day,
      count(*) AS trips
    FROM trips
    WHERE ${df}
    GROUP BY day
    ORDER BY day
  `);

  return c.json(
    rows.map((r) => ({
      day: String(r.day),
      trips: Number(r.trips),
    }))
  );
});

// ─── /api/months ─────────────────────────────────────────────────────────────
app.get("/api/months", async (c) => {
  const rows = await query(`
    SELECT
      date_trunc('month', started_at)::DATE AS month,
      count(*) AS trips
    FROM trips
    GROUP BY month
    ORDER BY month DESC
  `);

  return c.json(
    rows.map((r) => ({
      month: String(r.month),
      trips: Number(r.trips),
    }))
  );
});

// ─── /api/station-names ──────────────────────────────────────────────────────
app.get("/api/station-names", async (c) => {
  const q = c.req.query("q");
  const filter = q ? `AND start_station_name ILIKE '%${q.replace(/'/g, "''")}%'` : "";

  const rows = await query(`
    SELECT DISTINCT start_station_name
    FROM trips
    WHERE start_station_name IS NOT NULL AND start_station_name != ''
      ${filter}
    ORDER BY start_station_name
    LIMIT 20
  `);

  return c.json(rows.map((r) => r.start_station_name));
});

// ─── /api/route-lookup ───────────────────────────────────────────────────────
app.get("/api/route-lookup", async (c) => {
  const fromStation = c.req.query("from");
  const toStation = c.req.query("to");
  if (!fromStation || !toStation) {
    return c.json({ error: "from and to are required" }, 400);
  }

  const esc = (s: string) => s.replace(/'/g, "''");
  const f = esc(fromStation);
  const t = esc(toStation);

  const [r] = await query(`
    SELECT
      count(*) AS total_trips,
      round(avg(epoch(ended_at - started_at)) / 60, 1) AS avg_duration_min,
      min(started_at) AS first_trip,
      max(started_at) AS last_trip,
      sum(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) AS member_trips,
      round(avg(start_lat), 5) AS from_lat,
      round(avg(start_lng), 5) AS from_lng,
      round(avg(end_lat), 5)   AS to_lat,
      round(avg(end_lng), 5)   AS to_lng
    FROM trips
    WHERE start_station_name = '${f}' AND end_station_name = '${t}'
  `);

  const [rev] = await query(`
    SELECT count(*) AS cnt
    FROM trips
    WHERE start_station_name = '${t}' AND end_station_name = '${f}'
  `);

  const [peak] = await query(`
    SELECT extract('hour' FROM started_at) AS hr, count(*) AS cnt
    FROM trips
    WHERE start_station_name = '${f}' AND end_station_name = '${t}'
    GROUP BY hr
    ORDER BY cnt DESC
    LIMIT 1
  `);

  const totalTrips = Number(r.total_trips);
  const memberTrips = Number(r.member_trips);

  return c.json({
    from: fromStation,
    to: toStation,
    total_trips: totalTrips,
    reverse_trips: Number(rev.cnt),
    avg_duration_min: r.avg_duration_min != null ? Number(r.avg_duration_min) : null,
    member_trips: memberTrips,
    casual_trips: totalTrips - memberTrips,
    first_trip: r.first_trip ? String(r.first_trip) : null,
    last_trip: r.last_trip ? String(r.last_trip) : null,
    peak_hour: peak?.hr != null ? Number(peak.hr) : null,
    from_coords:
      r.from_lat != null
        ? [Number(r.from_lng), Number(r.from_lat)]
        : null,
    to_coords:
      r.to_lat != null ? [Number(r.to_lng), Number(r.to_lat)] : null,
  });
});

// ─── Serve frontend static build in production ──────────────────────────────
const staticDir = path.resolve(import.meta.dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(staticDir)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), staticDir) + "/" }));
  // SPA fallback — serve index.html for non-API, non-file routes
  app.get("*", (c) => {
    const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf-8");
    return c.html(html);
  });
}

// ─── Start server ────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 8000);
console.log(`Starting Bay Wheels API on port ${port}...`);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API running at http://localhost:${info.port}`);
});
