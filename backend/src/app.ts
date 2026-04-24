import { Hono } from "hono";
import { cors } from "hono/cors";
import { query, refreshSummaries } from "./db.js";
import { ingest } from "./ingest.js";
import { gbfsApp } from "./gbfs-routes.js";

export const app = new Hono();

app.use("*", async (c, next) => {
  const host = c.req.header("host");
  if (host === "baywheels.fly.dev") {
    const url = new URL(c.req.url);
    return c.redirect(`https://bikeshareviz.com${url.pathname}${url.search}`, 301);
  }
  return next();
});

app.use("/api/*", cors());
app.route("/", gbfsApp);

// ─── /api/ingest ──────────────────────────────────────────────────────────────
const INGEST_TOKEN = process.env.INGEST_TOKEN;
let ingesting = false;
app.post("/api/ingest", async (c) => {
  if (!INGEST_TOKEN) return c.json({ error: "Ingestion not configured" }, 503);
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${INGEST_TOKEN}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (ingesting) return c.json({ error: "Ingestion already in progress" }, 409);
  const recent = c.req.query("recent");
  const recentN = recent ? Number(recent) : 1;
  ingesting = true;
  try {
    await ingest(recentN);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  } finally {
    ingesting = false;
  }
});

// ─── /api/refresh ─────────────────────────────────────────────────────────────
type RefreshState = {
  running: boolean;
  startedAt?: number;
  completedAt?: number;
  error?: string;
};
let refreshState: RefreshState = { running: false };

app.post("/api/refresh", async (c) => {
  if (!INGEST_TOKEN) return c.json({ error: "Not configured" }, 503);
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${INGEST_TOKEN}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (refreshState.running) {
    return c.json({ error: "Refresh already in progress", state: refreshState }, 409);
  }
  refreshState = { running: true, startedAt: Date.now() };
  // Fire-and-forget. Status trackable via GET /api/refresh/status.
  refreshSummaries()
    .then(() => {
      refreshState = { running: false, startedAt: refreshState.startedAt, completedAt: Date.now() };
    })
    .catch((e: any) => {
      console.error("refreshSummaries failed:", e);
      refreshState = { running: false, startedAt: refreshState.startedAt, completedAt: Date.now(), error: e.message };
    });
  return c.json({ ok: true, state: refreshState }, 202);
});

app.get("/api/refresh/status", (c) => c.json(refreshState));

/** Build a WHERE clause for month-based filtering on summary tables. */
function monthFilter(start?: string, end?: string): string {
  const clauses: string[] = [];
  if (start) clauses.push(`month >= '${start}'`);
  if (end) clauses.push(`month < '${end}'`);
  return clauses.length ? clauses.join(" AND ") : "1=1";
}

/** Build a WHERE clause for day-based filtering. */
function dayFilter(start?: string, end?: string): string {
  const clauses: string[] = [];
  if (start) clauses.push(`day >= '${start}'`);
  if (end) clauses.push(`day < '${end}'`);
  return clauses.length ? clauses.join(" AND ") : "1=1";
}

// ─── /api/stats ──────────────────────────────────────────────────────────────
app.get("/api/stats", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const mf = monthFilter(start, end);

  const [stats] = await query(`
    SELECT
      sum(total_trips) AS total_trips,
      round(sum(duration_sum_sec) / sum(duration_count) / 60, 1) AS avg_duration_min,
      sum(active_days) AS active_days,
      sum(member_trips) AS member_trips,
      sum(casual_trips) AS casual_trips,
      sum(stationless_trips) AS stationless_trips
    FROM monthly_stats
    WHERE ${mf}
  `);

  const [stationCount] = await query(`
    SELECT count(DISTINCT station_id) AS active_stations
    FROM monthly_stations
    WHERE ${mf}
  `);

  const [busiest] = await query(`
    SELECT station_name, sum(departures) AS cnt
    FROM monthly_stations
    WHERE ${mf}
    GROUP BY station_name
    ORDER BY cnt DESC
    LIMIT 1
  `);

  const [peak] = await query(`
    SELECT hour AS hr, sum(trips) AS cnt
    FROM monthly_hourly
    WHERE ${mf}
    GROUP BY hour
    ORDER BY cnt DESC
    LIMIT 1
  `);

  return c.json({
    total_trips: Number(stats.total_trips),
    active_stations: Number(stationCount.active_stations),
    avg_duration_min: Number(stats.avg_duration_min ?? 0),
    active_days: Number(stats.active_days),
    member_trips: Number(stats.member_trips),
    casual_trips: Number(stats.casual_trips),
    stationless_trips: Number(stats.stationless_trips),
    busiest_station: busiest?.station_name ?? null,
    busiest_station_trips: Number(busiest?.cnt ?? 0),
    peak_hour: peak?.hr != null ? Number(peak.hr) : null,
  });
});

// ─── /api/flows ──────────────────────────────────────────────────────────────
app.get("/api/flows", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limit = Number(c.req.query("limit") ?? 200);
  const mf = monthFilter(start, end);

  const rows = await query(`
    SELECT
      start_station_name,
      end_station_name,
      round(avg(start_lat), 5) AS start_lat,
      round(avg(start_lng), 5) AS start_lng,
      round(avg(end_lat), 5)   AS end_lat,
      round(avg(end_lng), 5)   AS end_lng,
      sum(trip_count)           AS trip_count
    FROM monthly_flows
    WHERE ${mf}
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
  const mf = monthFilter(start, end);

  const rows = await query(`
    SELECT
      station_name,
      max(station_id) AS station_id,
      round(avg(lat), 5) AS lat,
      round(avg(lng), 5) AS lng,
      sum(departures) AS departures,
      sum(arrivals) AS arrivals
    FROM monthly_stations
    WHERE ${mf}
    GROUP BY station_name
    ORDER BY departures DESC
  `);

  return c.json(
    rows.map((r) => ({
      name: r.station_name,
      id: r.station_id,
      position: [Number(r.lng), Number(r.lat)],
      departures: Number(r.departures),
      arrivals: Number(r.arrivals),
    }))
  );
});

// ─── /api/hourly ─────────────────────────────────────────────────────────────
app.get("/api/hourly", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const mf = monthFilter(start, end);

  // Check if is_weekend column exists (table may not have been refreshed yet)
  let hasWeekend = false;
  try {
    const cols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'monthly_hourly' AND column_name = 'is_weekend'`);
    hasWeekend = cols.length > 0;
  } catch {}

  const rows = hasWeekend
    ? await query(`
        SELECT hour, is_weekend, sum(trips) AS trips, sum(member_trips) AS member_trips, sum(casual_trips) AS casual_trips
        FROM monthly_hourly WHERE ${mf}
        GROUP BY hour, is_weekend ORDER BY hour, is_weekend
      `)
    : await query(`
        SELECT hour, 0 AS is_weekend, sum(trips) AS trips, sum(member_trips) AS member_trips, sum(casual_trips) AS casual_trips
        FROM monthly_hourly WHERE ${mf}
        GROUP BY hour ORDER BY hour
      `);

  // Group by hour with weekday/weekend split
  const byHour: Record<number, { hour: number; weekday: number; weekend: number; member: number; casual: number }> = {};
  for (const r of rows) {
    const h = Number(r.hour);
    if (!byHour[h]) byHour[h] = { hour: h, weekday: 0, weekend: 0, member: 0, casual: 0 };
    const trips = Number(r.trips);
    if (Number(r.is_weekend)) {
      byHour[h].weekend += trips;
    } else {
      byHour[h].weekday += trips;
    }
    byHour[h].member += Number(r.member_trips);
    byHour[h].casual += Number(r.casual_trips);
  }

  return c.json(
    Object.values(byHour).sort((a, b) => a.hour - b.hour).map((d) => ({
      ...d,
      trips: d.weekday + d.weekend,
    }))
  );
});

// ─── /api/daily ──────────────────────────────────────────────────────────────
app.get("/api/daily", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const df = dayFilter(start, end);

  const rows = await query(`
    SELECT day, trips
    FROM daily_trips
    WHERE ${df}
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
    SELECT month, total_trips AS trips
    FROM monthly_stats
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
  const filter = q ? `WHERE start_station_name ILIKE '%${q.replace(/'/g, "''")}%'` : "";

  const rows = await query(`
    SELECT start_station_name
    FROM station_names
    ${filter}
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

  // Resolve fuzzy station names to best match
  const resolve = async (name: string, col: string) => {
    const e = esc(name);
    // Try exact match first
    const [exact] = await query(`SELECT ${col} AS n FROM trips WHERE ${col} = '${e}' LIMIT 1`);
    if (exact) return esc(String(exact.n));
    // Fall back to ILIKE prefix, then contains
    const [prefix] = await query(`SELECT ${col} AS n FROM trips WHERE ${col} ILIKE '${e}%' LIMIT 1`);
    if (prefix) return esc(String(prefix.n));
    const [contains] = await query(`SELECT ${col} AS n FROM trips WHERE ${col} ILIKE '%${e}%' LIMIT 1`);
    if (contains) return esc(String(contains.n));
    return e;
  };

  const resolvedFrom = await resolve(f, "start_station_name");
  const resolvedTo = await resolve(t, "end_station_name");

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
    WHERE start_station_name = '${resolvedFrom}' AND end_station_name = '${resolvedTo}'
  `);

  const [rev] = await query(`
    SELECT count(*) AS cnt
    FROM trips
    WHERE start_station_name = '${resolvedTo}' AND end_station_name = '${resolvedFrom}'
  `);

  const [peak] = await query(`
    SELECT extract('hour' FROM started_at) AS hr, count(*) AS cnt
    FROM trips
    WHERE start_station_name = '${resolvedFrom}' AND end_station_name = '${resolvedTo}'
    GROUP BY hr
    ORDER BY cnt DESC
    LIMIT 1
  `);

  const totalTrips = Number(r.total_trips);
  const memberTrips = Number(r.member_trips);

  return c.json({
    from: resolvedFrom.replace(/''/g, "'"),
    to: resolvedTo.replace(/''/g, "'"),
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
