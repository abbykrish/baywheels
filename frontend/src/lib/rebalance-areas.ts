// Group per-station "Clusters" (as defined in the MTC agreement §1.38) into
// distinct Violation Areas for display. The contract defines a Cluster with
// respect to any Station, so stations that are mutually within 1/3 mile each
// produce their own overlapping Cluster — four adjacent stations generate four
// per-station Clusters with near-identical membership, which creates four
// near-duplicate rows in the UI.
//
// Penalty attribution under the contract is per-Cluster ($1/min beyond 10 min
// per Cluster Outage), so we *sum* the per-cluster penalties when merging — a
// merged "area" penalty equals what Lyft would actually be charged for that
// geographic footprint. We also surface `cluster_count` so callers can see how
// many per-station Clusters fed into the aggregate.

export interface RawCluster {
  station_id: string;
  station_name: string;
  lat: number;
  lon: number;
  cluster_members: Array<{ station_id: string; station_name: string; lat: number; lon: number; distance_meters: number }>;
  outage_count: number;
  total_outage_minutes: number;
  penalty_dollars: number;
  empty_minutes: number;
  full_minutes: number;
  empty_penalty_dollars: number;
  full_penalty_dollars: number;
  worst_outage_minutes: number;
  last_outage_end: string | null;
}

export interface ViolationArea {
  key: string;                  // stable identifier (sorted station ids joined)
  stations: Array<{ station_id: string; station_name: string; lat: number; lon: number }>;
  cluster_count: number;        // # of per-station Clusters merged into this area
  penalty_dollars: number;      // summed across merged per-station clusters
  outage_count: number;
  empty_minutes: number;
  full_minutes: number;
  empty_penalty_dollars: number;
  full_penalty_dollars: number;
  worst_outage_minutes: number;
  last_outage_end: string | null;
  centroid_lat: number;
  centroid_lon: number;
  extent_meters: number;        // max distance from centroid to any station
}

const EARTH_R = 6_371_000;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

function membersSet(c: RawCluster): Set<string> {
  const s = new Set<string>([c.station_id]);
  if (Array.isArray(c.cluster_members)) for (const m of c.cluster_members) s.add(m.station_id);
  return s;
}

/**
 * Group per-station Clusters into Violation Areas via union-find. Two clusters
 * are unioned if they share at least `minShared` stations.
 *
 * Threshold of 3 means two clusters merge only when they share three or more
 * stations — tighter than a single bridge station, which avoids chaining
 * geographically distinct clusters through a shared corner station.
 */
export function groupIntoAreas(raw: RawCluster[], minShared: number = 3): ViolationArea[] {
  if (raw.length === 0) return [];

  const n = raw.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const pi = find(i), pj = find(j);
    if (pi !== pj) parent[pi] = pj;
  };

  const sets = raw.map(membersSet);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let shared = 0;
      for (const id of sets[i]) if (sets[j].has(id)) shared++;
      if (shared >= minShared) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i);
    else groups.set(root, [i]);
  }

  const areas: ViolationArea[] = [];
  for (const [, members] of groups) {
    const stationsMap = new Map<string, { station_id: string; station_name: string; lat: number; lon: number }>();
    let penalty = 0, outages = 0, emptyMin = 0, fullMin = 0;
    let emptyPenalty = 0, fullPenalty = 0, worst = 0;
    let lastEnd: string | null = null;

    for (const idx of members) {
      const c = raw[idx];
      if (!stationsMap.has(c.station_id)) {
        stationsMap.set(c.station_id, { station_id: c.station_id, station_name: c.station_name, lat: c.lat, lon: c.lon });
      }
      if (Array.isArray(c.cluster_members)) {
        for (const m of c.cluster_members) {
          if (!stationsMap.has(m.station_id)) {
            stationsMap.set(m.station_id, { station_id: m.station_id, station_name: m.station_name, lat: m.lat, lon: m.lon });
          }
        }
      }
      penalty += c.penalty_dollars;
      outages += c.outage_count;
      emptyMin += c.empty_minutes;
      fullMin += c.full_minutes;
      emptyPenalty += c.empty_penalty_dollars || 0;
      fullPenalty += c.full_penalty_dollars || 0;
      if (c.worst_outage_minutes > worst) worst = c.worst_outage_minutes;
      if (c.last_outage_end && (!lastEnd || c.last_outage_end > lastEnd)) lastEnd = c.last_outage_end;
    }

    const stations = [...stationsMap.values()];
    const centroidLat = stations.reduce((s, st) => s + st.lat, 0) / stations.length;
    const centroidLon = stations.reduce((s, st) => s + st.lon, 0) / stations.length;
    const extentM = stations.reduce((m, st) => Math.max(m, haversineMeters(centroidLat, centroidLon, st.lat, st.lon)), 0);
    const key = stations.map((s) => s.station_id).sort().join("|");

    areas.push({
      key,
      stations,
      cluster_count: members.length,
      penalty_dollars: penalty,
      outage_count: outages,
      empty_minutes: Math.round(emptyMin * 10) / 10,
      full_minutes: Math.round(fullMin * 10) / 10,
      empty_penalty_dollars: emptyPenalty,
      full_penalty_dollars: fullPenalty,
      worst_outage_minutes: worst,
      last_outage_end: lastEnd,
      centroid_lat: centroidLat,
      centroid_lon: centroidLon,
      extent_meters: extentM,
    });
  }

  areas.sort((a, b) => b.penalty_dollars - a.penalty_dollars);
  return areas;
}
