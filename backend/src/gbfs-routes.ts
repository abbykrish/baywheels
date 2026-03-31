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

gbfsApp.get("/api/live/coverage", async (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  const stations = getLatestStations();

  // Query % of time each station had 0 ebikes over last 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);
  let emptyMap = new Map<string, number>();
  const decommissioned = new Set<string>();
  try {
    const cutoff2d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);
    const rows = await query(`
      SELECT station_id,
             count(*) AS total,
             sum(CASE WHEN num_bikes_available = 0 THEN 1 ELSE 0 END) AS zero
      FROM gbfs_station_snapshots
      WHERE snapshot_ts >= '${cutoff}'
        AND extract('hour' FROM snapshot_ts) >= 6
      GROUP BY station_id
    `);
    // Detect stations at 0 bikes for 2+ days straight
    const deadRows = await query(`
      SELECT station_id
      FROM gbfs_station_snapshots
      WHERE snapshot_ts >= '${cutoff2d}'
      GROUP BY station_id
      HAVING max(num_bikes_available) = 0
    `);
    for (const r of deadRows) decommissioned.add(String(r.station_id));

    for (const r of rows) {
      const total = Number(r.total);
      const zero = Number(r.zero);
      if (total > 0) emptyMap.set(String(r.station_id), Math.round((zero / total) * 100));
    }
  } catch {}

  const all = stations
    .filter((s) => s.is_installed && s.capacity > 0 && !decommissioned.has(s.station_id))
    .map((s) => {
      const totalBikes = s.num_bikes_available;
      const emptyDocks = s.capacity - totalBikes;
      const fillPct = Math.round((totalBikes / s.capacity) * 100);
      const pctTimeEmpty = emptyMap.get(s.station_id) ?? 0;
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
        pct_time_empty: pctTimeEmpty,
      };
    });

  // Emptiest: highest % time empty first, tiebreak by fewer current ebikes
  const emptiest = [...all]
    .sort((a, b) => b.pct_time_empty - a.pct_time_empty || a.ebikes - b.ebikes)
    .slice(0, limit);

  // Best: lowest % time empty first, tiebreak by more current ebikes
  const best = [...all]
    .sort((a, b) => a.pct_time_empty - b.pct_time_empty || b.ebikes - a.ebikes)
    .slice(0, limit);

  return c.json({ emptiest, best });
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

  // Get all snapshots for the past week, ordered by time
  const rows = await query(`
    SELECT snapshot_ts, num_ebikes_available
    FROM gbfs_station_snapshots
    WHERE station_id = '${escapedId}'
      AND snapshot_ts >= '${cutoff}'
    ORDER BY snapshot_ts
  `);

  if (!rows.length) {
    return c.json({ avg_time: null, occurrences: 0, days_empty: 0, days_total: 0 });
  }

  // Group snapshots by day (Pacific time, UTC-7 approx)
  const PDT_OFFSET = 7 * 60 * 60 * 1000;
  // Get the 7 most recent full calendar days (exclude today since it's partial)
  const todayLocal = new Date(Date.now() - PDT_OFFSET).toISOString().slice(0, 10);
  const byDay = new Map<string, { ts: Date; ebikes: number }[]>();
  for (const r of rows) {
    const d = new Date(String(r.snapshot_ts).replace(" ", "T") + "Z");
    const local = new Date(d.getTime() - PDT_OFFSET);
    const dayKey = local.toISOString().slice(0, 10);
    if (dayKey === todayLocal) continue; // skip partial today
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push({ ts: d, ebikes: Number(r.num_ebikes_available) });
  }
  // Keep only the 7 most recent days
  const sortedDays = [...byDay.keys()].sort().slice(-7);
  const filteredDays = new Map(sortedDays.map((k) => [k, byDay.get(k)!]));

  // Collect all depletion events: times ebikes hit 0 and stayed 0 for 15+ min
  const SUSTAIN_MS = 10 * 60 * 1000;
  const numDays = filteredDays.size;
  const allDepletions: number[] = []; // time-of-day in minutes from midnight (Pacific)

  for (const [, snapshots] of filteredDays) {
    let i = 0;
    while (i < snapshots.length) {
      if (snapshots[i].ebikes > 0) { i++; continue; }
      // Found a zero — check if it stays 0 for 15+ min
      const zeroStart = snapshots[i].ts.getTime();
      let j = i + 1;
      while (j < snapshots.length && snapshots[j].ebikes === 0) j++;
      const duration = j > i + 1 ? snapshots[j - 1].ts.getTime() - zeroStart : 0;
      if (duration >= SUSTAIN_MS) {
        const local = new Date(zeroStart - PDT_OFFSET);
        const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
        if (local.getUTCHours() >= 6) { // skip before 6 AM
          allDepletions.push(mins);
        }
      }
      i = j;
    }
  }

  if (!allDepletions.length) {
    return c.json({ avg_time: null, occurrences: 0, days_empty: 0, days_total: numDays });
  }

  // Bucket depletions by 30-min window, find the most common window
  const buckets = new Map<number, number[]>(); // bucket key -> list of minute-of-day values
  for (const mins of allDepletions) {
    const bucket = Math.floor(mins / 30); // 0 = 0:00-0:29, 1 = 0:30-0:59, etc.
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(mins);
  }

  let bestBucket = 0;
  let bestCount = 0;
  for (const [bucket, times] of buckets) {
    if (times.length > bestCount) {
      bestCount = times.length;
      bestBucket = bucket;
    }
  }

  // Average the actual times within the winning bucket for a precise time
  const winningTimes = buckets.get(bestBucket)!;
  const avgMin = Math.round(winningTimes.reduce((a, b) => a + b, 0) / winningTimes.length);
  const h = Math.floor(avgMin / 60);
  const m = avgMin % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hr12 = h % 12 || 12;
  const avg_time = `${hr12}:${String(m).padStart(2, "0")} ${ampm}`;

  // days_empty = how many days contributed to the winning bucket
  // (each day can only contribute once per bucket since we track per-day depletions)
  const daysEmpty = Math.min(bestCount, numDays);

  return c.json({ avg_time, occurrences: allDepletions.length, days_empty: daysEmpty, days_total: numDays });
});
