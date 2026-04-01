import { Hono } from "hono";
import { query } from "./db.js";
import { getLatestStations } from "./gbfs.js";

export const slaApp = new Hono();

const CACHE_TTL = 5 * 60_000; // 5 minutes
const THIRD_MILE_M = 536.448;

// ─── Haversine distance in meters ───────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Cluster computation (cached) ───────────────────────────────────────────

interface Cluster {
  key: string;
  station_ids: string[];
  station_names: string[];
  center_lat: number;
  center_lon: number;
}

let clusterCache: { clusters: Cluster[]; stationCount: number } | null = null;

function computeClusters(): Cluster[] {
  const stations = getLatestStations().filter((s) => s.is_installed && s.capacity > 0);
  if (clusterCache && clusterCache.stationCount === stations.length) return clusterCache.clusters;

  const stationMap = new Map(stations.map((s) => [s.station_id, s]));

  // For each station, find its cluster
  const seen = new Set<string>();
  const clusters: Cluster[] = [];

  for (const s of stations) {
    const distances = stations
      .filter((o) => o.station_id !== s.station_id)
      .map((o) => ({ id: o.station_id, dist: haversineM(s.lat, s.lon, o.lat, o.lon) }))
      .sort((a, b) => a.dist - b.dist);

    let neighbors = distances.filter((d) => d.dist <= THIRD_MILE_M);
    if (neighbors.length < 3) neighbors = distances.slice(0, 3);

    const ids = [s.station_id, ...neighbors.map((n) => n.id)].sort();
    const key = ids.join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const clusterStations = ids.map((id) => stationMap.get(id)!).filter(Boolean);
    clusters.push({
      key,
      station_ids: ids,
      station_names: clusterStations.map((s) => s.name),
      center_lat: clusterStations.reduce((sum, s) => sum + s.lat, 0) / clusterStations.length,
      center_lon: clusterStations.reduce((sum, s) => sum + s.lon, 0) / clusterStations.length,
    });
  }

  clusterCache = { clusters, stationCount: stations.length };
  return clusters;
}

// ─── GET /api/sla/clusters ──────────────────────────────────────────────────

interface ClusterViolation {
  type: "no_bikes" | "no_docks";
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  penalty_dollars: number;
}

let clusterViolationCache: { data: any; ts: number } | null = null;

slaApp.get("/api/sla/clusters", async (c) => {
  if (clusterViolationCache && Date.now() - clusterViolationCache.ts < CACHE_TTL) {
    return c.json(clusterViolationCache.data);
  }

  const clusters = computeClusters();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  // Get all peak-hour snapshots for last 24h
  const rows = await query(`
    SELECT snapshot_ts, station_id, num_bikes_available, num_docks_available
    FROM gbfs_station_snapshots
    WHERE snapshot_ts >= '${cutoff}'
      AND extract('hour' FROM snapshot_ts) >= 6
      AND extract('hour' FROM snapshot_ts) < 22
    ORDER BY snapshot_ts
  `);

  // Index snapshots by timestamp -> station_id -> {bikes, docks}
  const snapsByTs = new Map<string, Map<string, { bikes: number; docks: number }>>();
  for (const r of rows) {
    const ts = String(r.snapshot_ts);
    if (!snapsByTs.has(ts)) snapsByTs.set(ts, new Map());
    snapsByTs.get(ts)!.set(String(r.station_id), {
      bikes: Number(r.num_bikes_available),
      docks: Number(r.num_docks_available),
    });
  }

  const timestamps = [...snapsByTs.keys()].sort();

  // For each cluster, walk through timestamps and detect outages
  const results = clusters.map((cluster) => {
    const violations: ClusterViolation[] = [];
    let currentOutage: { type: "no_bikes" | "no_docks"; startIdx: number } | null = null;

    for (let i = 0; i < timestamps.length; i++) {
      const snap = snapsByTs.get(timestamps[i])!;

      // Check if ALL stations in cluster have 0 bikes
      const allNoBikes = cluster.station_ids.every((id) => {
        const s = snap.get(id);
        return s ? s.bikes === 0 : true; // missing = assume empty
      });
      // Check if ALL stations in cluster have 0 docks
      const allNoDocks = cluster.station_ids.every((id) => {
        const s = snap.get(id);
        return s ? s.docks === 0 : true;
      });

      const outageType: "no_bikes" | "no_docks" | null =
        allNoBikes ? "no_bikes" : allNoDocks ? "no_docks" : null;

      if (outageType && currentOutage && currentOutage.type === outageType) {
        // Continue existing outage
      } else if (outageType) {
        // End previous outage if any
        if (currentOutage) {
          finishOutage(currentOutage, i - 1, timestamps, violations);
        }
        currentOutage = { type: outageType, startIdx: i };
      } else if (currentOutage) {
        finishOutage(currentOutage, i - 1, timestamps, violations);
        currentOutage = null;
      }
    }
    // Handle ongoing outage
    if (currentOutage) {
      finishOutage(currentOutage, timestamps.length - 1, timestamps, violations, true);
    }

    const total_penalty = violations.reduce((s, v) => s + v.penalty_dollars, 0);
    return { ...cluster, violations, total_penalty };
  });

  const withViolations = results.filter((r) => r.violations.length > 0);
  const data = {
    clusters: withViolations,
    summary: {
      total_violations: withViolations.reduce((s, c) => s + c.violations.length, 0),
      total_penalty: withViolations.reduce((s, c) => s + c.total_penalty, 0),
      active_violations: withViolations.filter((c) =>
        c.violations.some((v) => v.ended_at === null)
      ).length,
    },
  };

  clusterViolationCache = { data, ts: Date.now() };
  return c.json(data);
});

function finishOutage(
  outage: { type: "no_bikes" | "no_docks"; startIdx: number },
  endIdx: number,
  timestamps: string[],
  violations: ClusterViolation[],
  ongoing = false,
) {
  const startTs = new Date(timestamps[outage.startIdx].replace(" ", "T") + "Z");
  const endTs = new Date(timestamps[endIdx].replace(" ", "T") + "Z");
  const durationMin = Math.round((endTs.getTime() - startTs.getTime()) / 60_000);
  if (durationMin >= 10) {
    const penaltyMin = durationMin - 10;
    violations.push({
      type: outage.type,
      started_at: timestamps[outage.startIdx],
      ended_at: ongoing ? null : timestamps[endIdx],
      duration_minutes: durationMin,
      penalty_dollars: penaltyMin,
    });
  }
}

// ─── GET /api/sla/distribution ──────────────────────────────────────────────

let distributionCache: { data: any; ts: number } | null = null;

slaApp.get("/api/sla/distribution", async (c) => {
  if (distributionCache && Date.now() - distributionCache.ts < CACHE_TTL) {
    return c.json(distributionCache.data);
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  const rows = await query(`
    SELECT s.snapshot_ts, s.station_id, g.name AS station_name, g.lat, g.lon,
           s.num_bikes_available, s.num_docks_available, g.capacity
    FROM gbfs_station_snapshots s
    JOIN gbfs_stations g ON s.station_id = g.station_id
    WHERE s.snapshot_ts >= '${cutoff}'
      AND extract('hour' FROM s.snapshot_ts) >= 6
      AND extract('hour' FROM s.snapshot_ts) < 22
    ORDER BY s.station_id, s.snapshot_ts
  `);

  // Group by station, walk chronologically
  const byStation = new Map<string, Array<{
    ts: string; bikes: number; docks: number;
    name: string; lat: number; lon: number; capacity: number;
  }>>();

  for (const r of rows) {
    const id = String(r.station_id);
    if (!byStation.has(id)) byStation.set(id, []);
    byStation.get(id)!.push({
      ts: String(r.snapshot_ts),
      bikes: Number(r.num_bikes_available),
      docks: Number(r.num_docks_available),
      name: String(r.station_name),
      lat: Number(r.lat),
      lon: Number(r.lon),
      capacity: Number(r.capacity),
    });
  }

  interface DistViolation {
    station_id: string;
    station_name: string;
    lat: number;
    lon: number;
    type: "empty" | "full";
    started_at: string;
    ended_at: string | null;
    duration_minutes: number;
  }

  const violations: DistViolation[] = [];

  for (const [stationId, snaps] of byStation) {
    let emptyStart: number | null = null;
    let fullStart: number | null = null;
    const info = snaps[0];

    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i];
      const isEmpty = s.bikes === 0;
      const isFull = s.docks === 0;

      // Track empty streaks
      if (isEmpty && emptyStart === null) emptyStart = i;
      if (!isEmpty && emptyStart !== null) {
        checkDistViolation(snaps, stationId, info, "empty", emptyStart, i - 1, violations);
        emptyStart = null;
      }

      // Track full streaks
      if (isFull && fullStart === null) fullStart = i;
      if (!isFull && fullStart !== null) {
        checkDistViolation(snaps, stationId, info, "full", fullStart, i - 1, violations);
        fullStart = null;
      }
    }
    // Ongoing streaks
    if (emptyStart !== null) {
      checkDistViolation(snaps, stationId, info, "empty", emptyStart, snaps.length - 1, violations, true);
    }
    if (fullStart !== null) {
      checkDistViolation(snaps, stationId, info, "full", fullStart, snaps.length - 1, violations, true);
    }
  }

  const data = {
    violations: violations.sort((a, b) => b.duration_minutes - a.duration_minutes),
    summary: {
      total_violations: violations.length,
      active_violations: violations.filter((v) => v.ended_at === null).length,
    },
  };

  distributionCache = { data, ts: Date.now() };
  return c.json(data);
});

function checkDistViolation(
  snaps: Array<{ ts: string }>,
  stationId: string,
  info: { name: string; lat: number; lon: number },
  type: "empty" | "full",
  startIdx: number,
  endIdx: number,
  violations: any[],
  ongoing = false,
) {
  const startTs = new Date(snaps[startIdx].ts.replace(" ", "T") + "Z");
  const endTs = new Date(snaps[endIdx].ts.replace(" ", "T") + "Z");
  const durationMin = Math.round((endTs.getTime() - startTs.getTime()) / 60_000);
  if (durationMin >= 180) { // 3 hours
    violations.push({
      station_id: stationId,
      station_name: info.name,
      lat: info.lat,
      lon: info.lon,
      type,
      started_at: snaps[startIdx].ts,
      ended_at: ongoing ? null : snaps[endIdx].ts,
      duration_minutes: durationMin,
    });
  }
}

// ─── GET /api/sla/fleet ─────────────────────────────────────────────────────

let fleetCache: { data: any; ts: number } | null = null;

slaApp.get("/api/sla/fleet", async (c) => {
  if (fleetCache && Date.now() - fleetCache.ts < CACHE_TTL) {
    return c.json(fleetCache.data);
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);

  // Fleet availability: % of bikes operational, measured 11AM-3PM
  const rows = await query(`
    SELECT
      date_trunc('day', snapshot_ts)::date AS day,
      avg(num_bikes)::integer AS avg_total,
      avg(num_available)::integer AS avg_available
    FROM (
      SELECT snapshot_ts,
        sum(num_bikes_available + num_docks_available) AS num_bikes,
        sum(num_bikes_available) AS num_available
      FROM gbfs_station_snapshots
      WHERE snapshot_ts >= '${cutoff}'
        AND extract('hour' FROM snapshot_ts) >= 11
        AND extract('hour' FROM snapshot_ts) < 15
      GROUP BY snapshot_ts
    ) sub
    GROUP BY day
    ORDER BY day
  `);

  // Also check current fleet
  const stations = getLatestStations().filter((s) => s.is_installed);
  const currentAvailable = stations.reduce((s, st) => s + st.num_bikes_available, 0);
  const currentTotal = stations.reduce((s, st) => s + st.num_bikes_available + st.num_docks_available, 0);
  const currentPct = currentTotal > 0 ? Math.round((currentAvailable / currentTotal) * 100) : 100;

  const daily = rows.map((r) => {
    const total = Number(r.avg_total);
    const available = Number(r.avg_available);
    const pct = total > 0 ? Math.round((available / total) * 100) : 100;
    return {
      date: String(r.day),
      fleet_total: total,
      fleet_available: available,
      pct_available: pct,
      in_violation: pct < 90,
    };
  });

  const data = {
    daily,
    summary: {
      days_measured: daily.length,
      days_in_violation: daily.filter((d) => d.in_violation).length,
      current_pct: currentPct,
      current_total: currentTotal,
      current_available: currentAvailable,
    },
  };

  fleetCache = { data, ts: Date.now() };
  return c.json(data);
});
