import { Hono } from "hono";
import { query } from "./db.js";
import { getLatestStations, getLatestFreeBikes, getLastPollTime } from "./gbfs.js";
import { ensureRetentionTables } from "./gbfs-retention.js";

export const gbfsApp = new Hono();

// ─── Station exclusions ─────────────────────────────────────────────────────

function isExcludedStation(s: { name: string; is_installed: boolean; capacity: number; station_id: string }, decommissioned: Set<string>): boolean {
  if (!s.is_installed || s.capacity <= 0) return true;
  if (decommissioned.has(s.station_id)) return true;
  if (s.name.toLowerCase().includes("virtual")) return true;
  return false;
}

// ─── Cached heavy queries (recomputed at most once per minute) ──────────────

let coverageCache: { data: any; ts: number } | null = null;
let metaCache: { data: any; ts: number } | null = null;
let trendsCache: { data: any; ts: number; key: string } | null = null;
const CACHE_TTL = 60_000;

function refreshCounts(cached: any[]) {
  const fresh = getLatestStations();
  const map = new Map(fresh.map((s) => [s.station_id, s]));
  return cached.map((s) => {
    const live = map.get(s.station_id);
    if (!live) return s;
    const totalBikes = live.num_bikes_available;
    return {
      ...s,
      bikes: totalBikes,
      ebikes: live.num_ebikes_available,
      docks_available: live.num_docks_available,
      fill_pct: s.capacity > 0 ? Math.round((totalBikes / s.capacity) * 100) : 0,
    };
  });
}

async function getCachedCoverage(limit: number) {
  if (coverageCache && Date.now() - coverageCache.ts < CACHE_TTL) {
    const d = coverageCache.data;
    return {
      emptiest: refreshCounts(d.emptiest.slice(0, limit)),
      best: refreshCounts(d.best.slice(0, limit)),
    };
  }

  const stations = getLatestStations();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);
  const cutoff2d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  let emptyMap = new Map<string, number>();
  const decommissioned = new Set<string>();

  try {
    const [rows, deadRows] = await Promise.all([
      query(`
        SELECT station_id,
               count(*) AS total,
               sum(CASE WHEN num_bikes_available = 0 THEN 1 ELSE 0 END) AS zero
        FROM gbfs_station_snapshots
        WHERE snapshot_ts >= '${cutoff}'
          AND extract('hour' FROM snapshot_ts - INTERVAL '7 hours') >= 6
        GROUP BY station_id
      `),
      query(`
        SELECT station_id
        FROM gbfs_station_snapshots
        WHERE snapshot_ts >= '${cutoff2d}'
        GROUP BY station_id
        HAVING max(num_bikes_available) = 0
      `),
    ]);

    for (const r of deadRows) decommissioned.add(String(r.station_id));
    for (const r of rows) {
      const total = Number(r.total);
      const zero = Number(r.zero);
      if (total > 0) emptyMap.set(String(r.station_id), Math.round((zero / total) * 100));
    }
  } catch {}

  const all = stations
    .filter((s) => !isExcludedStation(s, decommissioned))
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

  const emptiest = [...all]
    .sort((a, b) => b.pct_time_empty - a.pct_time_empty || a.ebikes - b.ebikes);
  const best = [...all]
    .sort((a, b) => a.pct_time_empty - b.pct_time_empty || b.ebikes - a.ebikes);

  coverageCache = { data: { emptiest, best }, ts: Date.now() };
  return { emptiest: emptiest.slice(0, limit), best: best.slice(0, limit) };
}

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
  if (metaCache && Date.now() - metaCache.ts < CACHE_TTL) return c.json(metaCache.data);

  const stations = getLatestStations();
  const bikes = getLatestFreeBikes();
  const lastPoll = getLastPollTime();

  const totalEbikes = stations.reduce((sum, s) => sum + s.num_ebikes_available, 0);
  const totalBikes = stations.reduce((sum, s) => sum + s.num_bikes_available, 0);
  const totalClassics = totalBikes - totalEbikes;
  const totalCapacity = stations.reduce((sum, s) => sum + (s.capacity ?? 0), 0);
  const stationsAtZero = stations.filter((s) => s.num_ebikes_available === 0 && s.is_installed).length;

  let ebike_rides = 0;
  let classic_rides = 0;
  try {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);

    // Count ride ends at docks: positive deltas in ebike/classic counts per station.
    const dockRows = await query(`
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
        sum(CASE WHEN ebikes > prev_ebikes THEN ebikes - prev_ebikes ELSE 0 END) AS ebike_dock_ends,
        sum(CASE WHEN classics > prev_classics THEN classics - prev_classics ELSE 0 END) AS classic_dock_ends
      FROM ordered
      WHERE prev_ebikes IS NOT NULL
    `);

    // Count ride ends on the street: bike_ids whose first appearance in
    // gbfs_free_bikes falls within the window. bike_ids rotate per trip, so
    // a new id in the feed = a trip just ended with the bike parked off-dock.
    const streetRows = await query(`
      SELECT count(*) AS ebike_street_ends
      FROM (
        SELECT bike_id, min(snapshot_ts) AS first_seen
        FROM gbfs_free_bikes
        GROUP BY bike_id
      ) t
      WHERE first_seen >= '${cutoff}'
    `);

    const ebikeDockEnds = Number(dockRows[0]?.ebike_dock_ends ?? 0);
    const classicDockEnds = Number(dockRows[0]?.classic_dock_ends ?? 0);
    const ebikeStreetEnds = Number(streetRows[0]?.ebike_street_ends ?? 0);

    ebike_rides = ebikeDockEnds + ebikeStreetEnds;
    classic_rides = classicDockEnds;
  } catch {}

  // 30-day rolling utilization: trips per ebike per day. Denominator is the
  // current live fleet size (docked ebikes + free-floating bikes — classics
  // can't be dockless in this system). Contract thresholds shown for
  // reference: >6 overall, >1.5 casual (note: contract measures 12-month
  // rolling; this is 30-day for current conditions).
  let ebike_util_1mo: number | null = null;
  let casual_ebike_util_1mo: number | null = null;
  try {
    const cutoff1mo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);
    const rows = await query(`
      SELECT
        sum(CASE WHEN rideable_type = 'electric_bike' THEN 1 ELSE 0 END) AS ebike_trips,
        sum(CASE WHEN rideable_type = 'electric_bike'
                  AND member_casual IN ('casual', 'Customer') THEN 1 ELSE 0 END) AS casual_ebike_trips,
        date_diff('day', min(started_at), max(started_at)) AS span_days
      FROM trips
      WHERE started_at >= '${cutoff1mo}'
    `);
    const ebikeFleet = totalEbikes + bikes.length;
    const ebikeTrips = Number(rows[0]?.ebike_trips ?? 0);
    const casualEbikeTrips = Number(rows[0]?.casual_ebike_trips ?? 0);
    const spanDays = Math.max(1, Number(rows[0]?.span_days ?? 0));
    if (ebikeFleet > 0) {
      ebike_util_1mo = ebikeTrips / ebikeFleet / spanDays;
      casual_ebike_util_1mo = casualEbikeTrips / ebikeFleet / spanDays;
    }
  } catch (err) {
    console.error("util_1mo calc failed:", err);
  }

  const data = {
    last_poll: lastPoll?.toISOString() ?? null,
    station_count: stations.length,
    free_bike_count: bikes.length,
    total_ebikes: totalEbikes,
    total_classics: totalClassics,
    total_bikes: totalBikes,
    total_capacity: totalCapacity,
    stations_at_zero_ebikes: stationsAtZero,
    ebike_rides_6h: ebike_rides,
    classic_rides_6h: classic_rides,
    ebike_util_1mo,
    casual_ebike_util_1mo,
  };
  metaCache = { data, ts: Date.now() };
  return c.json(data);
});

// ─── GET /api/live/coverage ───────────────────────────────────────────────────

gbfsApp.get("/api/live/coverage", async (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  const result = await getCachedCoverage(limit);
  return c.json(result);
});


// ─── GET /api/live/trends ────────────────────────────────────────────────────

gbfsApp.get("/api/live/trends", async (c) => {
  const minutes = Math.min(Math.max(1, Number(c.req.query("minutes") ?? 5)), 60);
  const cacheKey = `trends_${minutes}`;
  if (trendsCache?.key === cacheKey && Date.now() - trendsCache.ts < CACHE_TTL) return c.json(trendsCache.data);

  const compareTime = new Date(Date.now() - minutes * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);
  const rows = await query(`
    WITH latest AS (
      SELECT max(snapshot_ts) AS ts FROM gbfs_station_snapshots
    ),
    prev AS (
      SELECT max(snapshot_ts) AS ts
      FROM gbfs_station_snapshots
      WHERE snapshot_ts <= '${compareTime}'
    ),
    recent AS (
      SELECT s.station_id, s.num_bikes_available, s.num_ebikes_available, s.num_docks_available, s.snapshot_ts,
        CASE WHEN s.snapshot_ts = (SELECT ts FROM latest) THEN 1 ELSE 2 END AS rn
      FROM gbfs_station_snapshots s
      WHERE s.snapshot_ts IN ((SELECT ts FROM latest), (SELECT ts FROM prev))
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

  const data = rows.map((r) => ({
    station_id: String(r.station_id),
    station_name: String(r.station_name),
    lat: Number(r.lat),
    lon: Number(r.lon),
    bikes_now: Number(r.bikes_now),
    ebikes_now: Number(r.ebikes_now),
    docks_now: Number(r.docks_now),
    bike_delta: Number(r.bike_delta),
    ebike_delta: Number(r.ebike_delta),
  }));
  trendsCache = { data, ts: Date.now(), key: cacheKey };
  return c.json(data);
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
