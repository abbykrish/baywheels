import { query } from "./db.js";
import { getLatestStations, isVirtualStation } from "./gbfs.js";

// ─── Contract parameters (Appendix A, KPI 12 of 2015 agreement) ───────────────
//
// Cluster (§1.38): for any Station S, the *other* Stations located within 1/3
// mi of S. If fewer than 3 other Stations are within 1/3 mi, the Cluster is
// the 3 other Stations closest to S. S itself is NOT a member of its own
// Cluster.
//
// Cluster Outage (§1.39): (a) no empty operable docks at any Station in the
// Cluster, OR (b) no available Bicycles at any Station in the Cluster.
//
// Rebalancing KPI (Appendix A, #12): no Cluster shall be in outage for >10
// consecutive minutes during Peak Hours (6:00 am – 10:00 pm local).
// Penalty: $1 per minute beyond the first 10 minutes.

const THIRD_MILE_METERS = 1609.344 / 3; // ≈ 536.45 m
const MIN_CLUSTER_MEMBERS = 3;          // excluding center
const OUTAGE_GRACE_MINUTES = 10;        // first 10 min are free
const PT_OFFSET_HOURS = 7;              // PDT. DST not modeled; existing code uses the same constant.
const PEAK_START_HOUR_PT = 6;
const PEAK_END_HOUR_PT = 22;            // exclusive: 10pm is the cutoff
const GAP_MS = 3 * 60 * 1000;           // tolerate poller hiccups ≤3 min
const CLUSTER_TTL_MS = 10 * 60 * 1000;  // cluster recompute window
const RESULT_TTL_MS = 5 * 60 * 1000;    // results cache TTL

// ─── Types ────────────────────────────────────────────────────────────────────

interface StationCoord {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
}

interface Interval {
  startMs: number;
  endMs: number;
}

interface ClusterMember {
  station_id: string;
  station_name: string;
  lat: number;
  lon: number;
  distance_meters: number; // 0 for the center itself (not included, but for reference)
}

interface OutageEvent {
  cluster_center_id: string;
  cluster_center_name: string;
  cluster_members: ClusterMember[];
  kind: "empty" | "full";
  start_ts: string; // ISO
  end_ts: string;   // ISO
  duration_min: number;
  penalty_dollars: number;
}

interface StationAttribution {
  station_id: string;
  station_name: string;
  lat: number;
  lon: number;
  cluster_members: ClusterMember[];
  outage_count: number;
  total_outage_minutes: number;
  penalty_dollars: number;
  empty_minutes: number;
  full_minutes: number;
  empty_penalty_dollars: number;
  full_penalty_dollars: number;
  worst_outage_minutes: number;
  last_outage_end: string | null; // ISO
}

export interface RebalancingKpiResult {
  window_hours: number;
  from_ts: string;
  to_ts: string;
  total_penalty_dollars: number;
  empty_penalty_dollars: number;
  full_penalty_dollars: number;
  total_outage_events: number;
  total_outage_minutes: number;
  avg_outage_minutes: number;
  worst_outage_minutes: number;
  affected_cluster_count: number;
  by_station: StationAttribution[];   // attribution by cluster center station
  events: OutageEvent[];              // detailed list
  peak_hours_pt: { start: number; end: number };
  generated_at: string;
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Cluster computation ──────────────────────────────────────────────────────

let clusterCache: { map: Map<string, string[]>; stations: Map<string, StationCoord>; ts: number } | null = null;

async function getClusters(): Promise<{
  map: Map<string, string[]>;
  stations: Map<string, StationCoord>;
}> {
  if (clusterCache && Date.now() - clusterCache.ts < CLUSTER_TTL_MS) {
    return { map: clusterCache.map, stations: clusterCache.stations };
  }

  // Prefer live in-memory info, fall back to DB (covers cold start).
  let coords: StationCoord[] = getLatestStations()
    .filter((s) => s.is_installed && s.capacity > 0 && !isVirtualStation(s))
    .map((s) => ({ station_id: s.station_id, name: s.name, lat: s.lat, lon: s.lon }));

  if (coords.length === 0) {
    const rows = await query(`
      SELECT station_id, name, lat, lon FROM gbfs_stations
      WHERE capacity > 0 AND lower(name) NOT LIKE '%virtual%'
    `);
    coords = rows.map((r) => ({
      station_id: String(r.station_id),
      name: String(r.name),
      lat: Number(r.lat),
      lon: Number(r.lon),
    }));
  }

  const byId = new Map<string, StationCoord>(coords.map((s) => [s.station_id, s]));
  const map = new Map<string, string[]>();

  for (const s of coords) {
    const distances: Array<{ id: string; d: number }> = [];
    for (const o of coords) {
      if (o.station_id === s.station_id) continue;
      distances.push({ id: o.station_id, d: haversineMeters(s.lat, s.lon, o.lat, o.lon) });
    }
    distances.sort((a, b) => a.d - b.d);
    const within = distances.filter((x) => x.d <= THIRD_MILE_METERS);
    // Cluster excludes S itself. Use 3 nearest neighbors as fallback when
    // fewer than 3 other stations lie within 1/3 mi.
    const members =
      within.length >= MIN_CLUSTER_MEMBERS
        ? within.map((x) => x.id)
        : distances.slice(0, MIN_CLUSTER_MEMBERS).map((x) => x.id);
    map.set(s.station_id, members);
  }

  clusterCache = { map, stations: byId, ts: Date.now() };
  return { map, stations: byId };
}

// ─── Interval building ────────────────────────────────────────────────────────
//
// For each station we derive two interval lists: "empty" (no bikes) and
// "full" (no empty docks). We pre-filter snapshots to peak hours in SQL,
// so the natural 8-hour gap between each day's peak windows cleanly breaks
// runs that would otherwise span the overnight.

function buildIntervalsForStation(
  snapshots: Array<{ tsMs: number; bikes: number; docks: number }>,
): { empty: Interval[]; full: Interval[] } {
  const empty: Interval[] = [];
  const full: Interval[] = [];

  let emptyStart: number | null = null;
  let fullStart: number | null = null;
  let lastTs: number | null = null;

  const closeEmpty = (end: number) => {
    if (emptyStart != null) {
      empty.push({ startMs: emptyStart, endMs: end });
      emptyStart = null;
    }
  };
  const closeFull = (end: number) => {
    if (fullStart != null) {
      full.push({ startMs: fullStart, endMs: end });
      fullStart = null;
    }
  };

  for (const s of snapshots) {
    if (lastTs != null && s.tsMs - lastTs > GAP_MS) {
      // Gap — close any open intervals at the last known timestamp.
      closeEmpty(lastTs);
      closeFull(lastTs);
    }

    if (s.bikes === 0) {
      if (emptyStart == null) emptyStart = s.tsMs;
    } else {
      closeEmpty(lastTs ?? s.tsMs);
    }

    if (s.docks === 0) {
      if (fullStart == null) fullStart = s.tsMs;
    } else {
      closeFull(lastTs ?? s.tsMs);
    }

    lastTs = s.tsMs;
  }

  if (lastTs != null) {
    closeEmpty(lastTs);
    closeFull(lastTs);
  }

  return { empty, full };
}

// ─── Interval intersection ────────────────────────────────────────────────────

function intersectTwo(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].startMs, b[j].startMs);
    const end = Math.min(a[i].endMs, b[j].endMs);
    if (end > start) out.push({ startMs: start, endMs: end });
    if (a[i].endMs < b[j].endMs) i++;
    else j++;
  }
  return out;
}

function intersectAll(sets: Interval[][]): Interval[] {
  if (sets.length === 0) return [];
  let acc = sets[0];
  for (let i = 1; i < sets.length; i++) {
    if (acc.length === 0) return acc;
    acc = intersectTwo(acc, sets[i]);
  }
  return acc;
}

// ─── Main computation ─────────────────────────────────────────────────────────

let resultCache: { key: string; data: RebalancingKpiResult; ts: number } | null = null;

export async function computeRebalancingKpi(hours: number): Promise<RebalancingKpiResult> {
  // Hard cap at 24h: the in-memory scan OOM'd on a 2 GB VM for 7d windows.
  // Raise once interval detection moves into SQL window functions.
  const windowHours = Math.max(1, Math.min(hours, 24));
  const cacheKey = `kpi_${windowHours}`;

  if (resultCache?.key === cacheKey && Date.now() - resultCache.ts < RESULT_TTL_MS) {
    return resultCache.data;
  }

  const { map: clusterMap, stations: stationById } = await getClusters();

  const toTs = new Date();
  const fromTs = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const cutoffSql = fromTs.toISOString().replace("T", " ").slice(0, 19);

  // Pre-filter to peak hours in SQL. Natural overnight gap breaks runs.
  const rows = await query(`
    SELECT
      station_id,
      snapshot_ts,
      num_bikes_available,
      num_docks_available
    FROM gbfs_station_snapshots
    WHERE snapshot_ts >= '${cutoffSql}'
      AND extract('hour' FROM snapshot_ts - INTERVAL '${PT_OFFSET_HOURS} hours') >= ${PEAK_START_HOUR_PT}
      AND extract('hour' FROM snapshot_ts - INTERVAL '${PT_OFFSET_HOURS} hours') < ${PEAK_END_HOUR_PT}
    ORDER BY station_id, snapshot_ts
  `);

  // Bucket by station
  const perStation = new Map<string, Array<{ tsMs: number; bikes: number; docks: number }>>();
  for (const r of rows) {
    const id = String(r.station_id);
    const ts = String(r.snapshot_ts).replace(" ", "T") + "Z";
    const tsMs = Date.parse(ts);
    if (Number.isNaN(tsMs)) continue;
    const rec = {
      tsMs,
      bikes: Number(r.num_bikes_available),
      docks: Number(r.num_docks_available),
    };
    const bucket = perStation.get(id);
    if (bucket) bucket.push(rec);
    else perStation.set(id, [rec]);
  }

  // Per-station intervals
  const stationIntervals = new Map<string, { empty: Interval[]; full: Interval[] }>();
  for (const [id, snaps] of perStation) {
    stationIntervals.set(id, buildIntervalsForStation(snaps));
  }

  // Per-cluster intersection → outages
  const events: OutageEvent[] = [];
  const attribution = new Map<string, StationAttribution>();

  function buildMemberInfo(center: StationCoord, memberIds: string[]): ClusterMember[] {
    const out: ClusterMember[] = [];
    for (const mid of memberIds) {
      const m = stationById.get(mid);
      if (!m) continue;
      out.push({
        station_id: m.station_id,
        station_name: m.name,
        lat: m.lat,
        lon: m.lon,
        distance_meters: Math.round(haversineMeters(center.lat, center.lon, m.lat, m.lon)),
      });
    }
    // Closest member first
    out.sort((a, b) => a.distance_meters - b.distance_meters);
    return out;
  }

  function ensureAttribution(center: StationCoord, memberIds: string[]): StationAttribution {
    let a = attribution.get(center.station_id);
    if (!a) {
      a = {
        station_id: center.station_id,
        station_name: center.name,
        lat: center.lat,
        lon: center.lon,
        cluster_members: buildMemberInfo(center, memberIds),
        outage_count: 0,
        total_outage_minutes: 0,
        penalty_dollars: 0,
        empty_minutes: 0,
        full_minutes: 0,
        empty_penalty_dollars: 0,
        full_penalty_dollars: 0,
        worst_outage_minutes: 0,
        last_outage_end: null,
      };
      attribution.set(center.station_id, a);
    }
    return a;
  }

  for (const [centerId, members] of clusterMap) {
    const center = stationById.get(centerId);
    if (!center) continue;

    const emptySets: Interval[][] = [];
    const fullSets: Interval[][] = [];
    let hasData = true;
    for (const mid of members) {
      const iv = stationIntervals.get(mid);
      if (!iv) {
        // Missing data for a member → cluster can't be in verified outage.
        hasData = false;
        break;
      }
      emptySets.push(iv.empty);
      fullSets.push(iv.full);
    }
    if (!hasData) continue;

    const emptyOutages = intersectAll(emptySets);
    const fullOutages = intersectAll(fullSets);

    const memberInfo = buildMemberInfo(center, members);
    const processKind = (intervals: Interval[], kind: "empty" | "full") => {
      for (const iv of intervals) {
        const durationMin = (iv.endMs - iv.startMs) / 60_000;
        if (durationMin <= OUTAGE_GRACE_MINUTES) continue;
        const penalty = Math.round(durationMin - OUTAGE_GRACE_MINUTES);
        if (penalty <= 0) continue;

        events.push({
          cluster_center_id: center.station_id,
          cluster_center_name: center.name,
          cluster_members: memberInfo,
          kind,
          start_ts: new Date(iv.startMs).toISOString(),
          end_ts: new Date(iv.endMs).toISOString(),
          duration_min: Math.round(durationMin * 10) / 10,
          penalty_dollars: penalty,
        });

        const a = ensureAttribution(center, members);
        a.outage_count += 1;
        a.total_outage_minutes += durationMin;
        a.penalty_dollars += penalty;
        if (kind === "empty") {
          a.empty_minutes += durationMin;
          a.empty_penalty_dollars += penalty;
        } else {
          a.full_minutes += durationMin;
          a.full_penalty_dollars += penalty;
        }
        if (durationMin > a.worst_outage_minutes) a.worst_outage_minutes = durationMin;
        const endIso = new Date(iv.endMs).toISOString();
        if (!a.last_outage_end || endIso > a.last_outage_end) a.last_outage_end = endIso;
      }
    };
    processKind(emptyOutages, "empty");
    processKind(fullOutages, "full");
  }

  const byStation = [...attribution.values()]
    .map((a) => ({
      ...a,
      total_outage_minutes: Math.round(a.total_outage_minutes * 10) / 10,
      empty_minutes: Math.round(a.empty_minutes * 10) / 10,
      full_minutes: Math.round(a.full_minutes * 10) / 10,
      worst_outage_minutes: Math.round(a.worst_outage_minutes * 10) / 10,
    }))
    .sort((a, b) => b.penalty_dollars - a.penalty_dollars);

  events.sort((a, b) => b.penalty_dollars - a.penalty_dollars);

  const totalPenalty = events.reduce((sum, e) => sum + e.penalty_dollars, 0);
  const totalMinutes = events.reduce((sum, e) => sum + e.duration_min, 0);
  const emptyPenalty = events.filter((e) => e.kind === "empty").reduce((s, e) => s + e.penalty_dollars, 0);
  const fullPenalty = events.filter((e) => e.kind === "full").reduce((s, e) => s + e.penalty_dollars, 0);
  const worstOutage = events.reduce((m, e) => (e.duration_min > m ? e.duration_min : m), 0);
  const avgOutage = events.length ? totalMinutes / events.length : 0;

  const data: RebalancingKpiResult = {
    window_hours: windowHours,
    from_ts: fromTs.toISOString(),
    to_ts: toTs.toISOString(),
    total_penalty_dollars: totalPenalty,
    empty_penalty_dollars: emptyPenalty,
    full_penalty_dollars: fullPenalty,
    total_outage_events: events.length,
    total_outage_minutes: Math.round(totalMinutes * 10) / 10,
    avg_outage_minutes: Math.round(avgOutage * 10) / 10,
    worst_outage_minutes: Math.round(worstOutage * 10) / 10,
    affected_cluster_count: byStation.length,
    by_station: byStation,
    events,
    peak_hours_pt: { start: PEAK_START_HOUR_PT, end: PEAK_END_HOUR_PT },
    generated_at: new Date().toISOString(),
  };

  resultCache = { key: cacheKey, data, ts: Date.now() };
  return data;
}
