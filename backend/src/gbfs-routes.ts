import { Hono } from "hono";
import { query } from "./db.js";
import { getLatestStations, getLatestFreeBikes, getLastPollTime } from "./gbfs.js";
import { ensureRetentionTables } from "./gbfs-retention.js";

export const gbfsApp = new Hono();

// ─── GET /api/live/stations ──────────────────────────────────────────────────

gbfsApp.get("/api/live/stations", (c) => {
  const stations = getLatestStations();
  return c.json(stations);
});

// ─── GET /api/live/bikes ─────────────────────────────────────────────────────

gbfsApp.get("/api/live/bikes", (c) => {
  const bikes = getLatestFreeBikes();
  return c.json(bikes);
});

// ─── GET /api/live/meta ──────────────────────────────────────────────────────

gbfsApp.get("/api/live/meta", async (c) => {
  const stations = getLatestStations();
  const bikes = getLatestFreeBikes();
  const lastPoll = getLastPollTime();

  const totalEbikes = stations.reduce((sum, s) => sum + s.num_ebikes_available, 0);
  const totalBikes = stations.reduce((sum, s) => sum + s.num_bikes_available, 0);
  const totalClassics = totalBikes - totalEbikes;
  const stationsAtZero = stations.filter((s) => s.num_ebikes_available === 0 && s.is_installed).length;

  // Circulation: total absolute ebike/classic movements over last 6 hours
  let ebike_circulation = 0;
  let classic_circulation = 0;
  try {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);
    const rows = await query(`
      WITH ordered AS (
        SELECT
          station_id,
          num_ebikes_available AS ebikes,
          num_bikes_available - num_ebikes_available AS classics,
          lag(num_ebikes_available) OVER (PARTITION BY station_id ORDER BY snapshot_ts) AS prev_ebikes,
          lag(num_bikes_available - num_ebikes_available) OVER (PARTITION BY station_id ORDER BY snapshot_ts) AS prev_classics
        FROM gbfs_station_snapshots
        WHERE snapshot_ts >= '${cutoff}'
      )
      SELECT
        sum(abs(ebikes - prev_ebikes)) AS ebike_moves,
        sum(abs(classics - prev_classics)) AS classic_moves
      FROM ordered
      WHERE prev_ebikes IS NOT NULL
    `);
    if (rows.length) {
      ebike_circulation = Number(rows[0].ebike_moves ?? 0);
      classic_circulation = Number(rows[0].classic_moves ?? 0);
    }
  } catch {}

  return c.json({
    last_poll: lastPoll?.toISOString() ?? null,
    station_count: stations.length,
    free_bike_count: bikes.length,
    total_ebikes: totalEbikes,
    total_classics: totalClassics,
    stations_at_zero_ebikes: stationsAtZero,
    ebike_circulation,
    classic_circulation,
  });
});

// ─── GET /api/live/coverage ───────────────────────────────────────────────────

gbfsApp.get("/api/live/coverage", (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  const stations = getLatestStations();

  const all = stations
    .filter((s) => s.is_installed && s.capacity > 0)
    .map((s) => {
      const totalBikes = s.num_bikes_available;
      const emptyDocks = s.capacity - totalBikes;
      const fillPct = Math.round((totalBikes / s.capacity) * 100);
      // Continuous: ebike fill ratio (0-1), tiebreak by more empty docks first
      const ebikeRatio = s.num_ebikes_available / s.capacity;
      const emptinessScore = ebikeRatio * 1000000 + (1000 - emptyDocks);
      return {
        station_id: s.station_id,
        station_name: s.name,
        lat: s.lat,
        lon: s.lon,
        capacity: s.capacity,
        bikes: totalBikes,
        ebikes: s.num_ebikes_available,
        docks_available: s.num_docks_available,
        empty_docks: emptyDocks,
        fill_pct: fillPct,
        emptiness_score: emptinessScore,
      };
    })
    .sort((a, b) => a.emptiness_score - b.emptiness_score);

  return c.json({
    emptiest: all.slice(0, limit),
    best: all.slice(-limit).reverse(),
  });
});

// ─── GET /api/live/trends ────────────────────────────────────────────────────

gbfsApp.get("/api/live/trends", async (c) => {
  const rows = await query(`
    WITH snapshots AS (
      SELECT DISTINCT snapshot_ts
      FROM gbfs_station_snapshots
      ORDER BY snapshot_ts DESC
      LIMIT 2
    ),
    recent AS (
      SELECT s.station_id, s.num_bikes_available, s.num_ebikes_available, s.num_docks_available, s.snapshot_ts,
        row_number() OVER (PARTITION BY s.station_id ORDER BY s.snapshot_ts DESC) AS rn
      FROM gbfs_station_snapshots s
      WHERE s.snapshot_ts IN (SELECT snapshot_ts FROM snapshots)
    )
    SELECT
      cur.station_id,
      g.name AS station_name,
      g.lat,
      g.lon,
      cur.num_bikes_available AS bikes_now,
      cur.num_ebikes_available AS ebikes_now,
      cur.num_docks_available AS docks_now,
      prev.num_bikes_available AS bikes_prev,
      prev.num_ebikes_available AS ebikes_prev,
      cur.num_bikes_available - prev.num_bikes_available AS bike_delta,
      cur.num_ebikes_available - prev.num_ebikes_available AS ebike_delta
    FROM recent cur
    JOIN recent prev ON cur.station_id = prev.station_id AND prev.rn = 2
    JOIN gbfs_stations g ON cur.station_id = g.station_id
    WHERE cur.rn = 1
      AND (cur.num_bikes_available != prev.num_bikes_available
        OR cur.num_ebikes_available != prev.num_ebikes_available)
    ORDER BY abs(cur.num_bikes_available - prev.num_bikes_available) DESC
  `);

  return c.json(rows.map((r) => ({
    station_id: String(r.station_id),
    station_name: String(r.station_name),
    lat: Number(r.lat),
    lon: Number(r.lon),
    bikes_now: Number(r.bikes_now),
    ebikes_now: Number(r.ebikes_now),
    docks_now: Number(r.docks_now),
    bike_delta: Number(r.bike_delta),
    ebike_delta: Number(r.ebike_delta),
  })));
});

// ─── GET /api/station-history/:stationId ─────────────────────────────────────

gbfsApp.get("/api/station-history/:stationId", async (c) => {
  const stationId = c.req.param("stationId");
  const hours = Number(c.req.query("hours") ?? 24);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  const escapedId = stationId.replace(/'/g, "''");

  const rows = await query(`
    SELECT
      snapshot_ts,
      num_bikes_available,
      num_ebikes_available,
      num_docks_available
    FROM gbfs_station_snapshots
    WHERE station_id = '${escapedId}'
      AND snapshot_ts >= '${cutoff}'
    ORDER BY snapshot_ts
  `);

  return c.json(rows.map((r) => ({
    ts: String(r.snapshot_ts),
    bikes: Number(r.num_bikes_available),
    ebikes: Number(r.num_ebikes_available),
    docks: Number(r.num_docks_available),
  })));
});

// ─── GET /api/station-last-ebike/:stationId ─────────────────────────────────
// Average time-of-day when the last ebike left the station (over the past week)

gbfsApp.get("/api/station-last-ebike/:stationId", async (c) => {
  const stationId = c.req.param("stationId");
  const escapedId = stationId.replace(/'/g, "''");
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  const rows = await query(`
    WITH snapshots AS (
      SELECT
        snapshot_ts,
        num_ebikes_available,
        lag(num_ebikes_available) OVER (ORDER BY snapshot_ts) AS prev_ebikes
      FROM gbfs_station_snapshots
      WHERE station_id = '${escapedId}'
        AND snapshot_ts >= '${cutoff}'
    )
    SELECT snapshot_ts
    FROM snapshots
    WHERE prev_ebikes > 0 AND num_ebikes_available = 0
    ORDER BY snapshot_ts
  `);

  if (!rows.length) {
    return c.json({ avg_time: null, occurrences: 0 });
  }

  // Average the time-of-day (in minutes from midnight)
  let totalMinutes = 0;
  for (const r of rows) {
    const d = new Date(String(r.snapshot_ts).replace(" ", "T") + "Z");
    // Convert to local Pacific time approximation (UTC-7 for PDT)
    const local = new Date(d.getTime() - 7 * 60 * 60 * 1000);
    totalMinutes += local.getUTCHours() * 60 + local.getUTCMinutes();
  }
  const avgMin = Math.round(totalMinutes / rows.length);
  const h = Math.floor(avgMin / 60);
  const m = avgMin % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  const avg_time = `${hr}:${String(m).padStart(2, "0")} ${ampm}`;

  return c.json({ avg_time, occurrences: rows.length });
});
