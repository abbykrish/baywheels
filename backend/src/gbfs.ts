import { getConnection } from "./db.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GbfsStation {
  station_id: string;
  name: string;
  short_name: string;
  lat: number;
  lon: number;
  capacity: number;
  region_id: string;
}

interface GbfsStationStatus {
  station_id: string;
  num_bikes_available: number;
  num_ebikes_available: number;
  num_docks_available: number;
  num_bikes_disabled: number;
  num_docks_disabled: number;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  last_reported: number;
}

interface GbfsFreeBike {
  bike_id: string;
  lat: number;
  lon: number;
  is_disabled: boolean;
  is_reserved: boolean;
  current_range_meters: number | null;
}

interface LiveStation extends GbfsStation {
  num_bikes_available: number;
  num_ebikes_available: number;
  num_docks_available: number;
  num_bikes_disabled: number;
  num_docks_disabled: number;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  last_reported: number;
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

let latestStations: LiveStation[] = [];
let latestFreeBikes: GbfsFreeBike[] = [];
let lastPollTime: Date | null = null;

export function getLatestStations(): LiveStation[] {
  return latestStations;
}

export function getLatestFreeBikes(): GbfsFreeBike[] {
  return latestFreeBikes;
}

export function getLastPollTime(): Date | null {
  return lastPollTime;
}

// ─── GBFS feed URLs ──────────────────────────────────────────────────────────

const GBFS_BASE = "https://gbfs.lyft.com/gbfs/2.3/bay/en";
const STATION_INFO_URL = `${GBFS_BASE}/station_information.json`;
const STATION_STATUS_URL = `${GBFS_BASE}/station_status.json`;
const FREE_BIKE_URL = `${GBFS_BASE}/free_bike_status.json`;

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STATION_INFO_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 15_000;

// ─── Table creation ──────────────────────────────────────────────────────────

async function ensureTables(): Promise<void> {
  const conn = await getConnection();

  await conn.run(`
    CREATE TABLE IF NOT EXISTS gbfs_stations (
      station_id VARCHAR PRIMARY KEY,
      name VARCHAR,
      short_name VARCHAR,
      lat DOUBLE,
      lon DOUBLE,
      capacity INTEGER,
      region_id VARCHAR,
      updated_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS gbfs_station_snapshots (
      snapshot_ts TIMESTAMP,
      station_id VARCHAR,
      num_bikes_available INTEGER,
      num_ebikes_available INTEGER,
      num_docks_available INTEGER,
      num_bikes_disabled INTEGER,
      num_docks_disabled INTEGER,
      is_installed BOOLEAN,
      is_renting BOOLEAN,
      is_returning BOOLEAN,
      last_reported BIGINT
    )
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS gbfs_free_bikes (
      snapshot_ts TIMESTAMP,
      bike_id VARCHAR,
      lat DOUBLE,
      lon DOUBLE,
      is_disabled BOOLEAN,
      is_reserved BOOLEAN,
      current_range_meters DOUBLE
    )
  `);
}

// ─── Fetching ────────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`GBFS fetch failed: ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Station info (metadata) ─────────────────────────────────────────────────

let stationInfoMap = new Map<string, GbfsStation>();
let lastStationInfoFetch = 0;

async function refreshStationInfo(): Promise<void> {
  const now = Date.now();
  if (now - lastStationInfoFetch < STATION_INFO_INTERVAL_MS && stationInfoMap.size > 0) return;

  const data = await fetchJson(STATION_INFO_URL);
  const stations: any[] = data?.data?.stations ?? [];

  const conn = await getConnection();
  stationInfoMap.clear();

  for (const s of stations) {
    const station: GbfsStation = {
      station_id: s.station_id,
      name: s.name ?? "",
      short_name: s.short_name ?? "",
      lat: s.lat,
      lon: s.lon,
      capacity: s.capacity ?? 0,
      region_id: s.region_id ?? "",
    };
    stationInfoMap.set(station.station_id, station);
  }

  // Upsert into DuckDB
  await conn.run(`DELETE FROM gbfs_stations`);
  for (const s of stationInfoMap.values()) {
    await conn.run(`
      INSERT INTO gbfs_stations (station_id, name, short_name, lat, lon, capacity, region_id, updated_at)
      VALUES ('${esc(s.station_id)}', '${esc(s.name)}', '${esc(s.short_name)}', ${s.lat}, ${s.lon}, ${s.capacity}, '${esc(s.region_id)}', current_timestamp)
    `);
  }

  lastStationInfoFetch = now;
  console.log(`GBFS station info refreshed: ${stationInfoMap.size} stations`);
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

// ─── Poll cycle ──────────────────────────────────────────────────────────────

let polling = false;

async function pollCycle(): Promise<void> {
  if (polling) return;
  polling = true;

  try {
    await refreshStationInfo();

    const now = new Date();
    const ts = now.toISOString().replace("T", " ").slice(0, 19);

    // Fetch station status
    const statusData = await fetchJson(STATION_STATUS_URL);
    const statuses: any[] = statusData?.data?.stations ?? [];

    // Fetch free bikes
    const bikeData = await fetchJson(FREE_BIKE_URL);
    const bikes: any[] = bikeData?.data?.bikes ?? [];

    const conn = await getConnection();

    // Insert station snapshots
    if (statuses.length > 0) {
      const values = statuses.map((s) => {
        const ebikes = s.vehicle_types_available?.find((v: any) => v.vehicle_type_id === "2")?.count ?? 0;
        const regularBikes = s.num_bikes_available ?? 0;
        return `('${ts}', '${esc(String(s.station_id))}', ${regularBikes}, ${ebikes}, ${s.num_docks_available ?? 0}, ${s.num_bikes_disabled ?? 0}, ${s.num_docks_disabled ?? 0}, ${!!s.is_installed}, ${!!s.is_renting}, ${!!s.is_returning}, ${s.last_reported ?? 0})`;
      }).join(",\n");

      await conn.run(`
        INSERT INTO gbfs_station_snapshots VALUES ${values}
      `);
    }

    // Insert free bikes
    if (bikes.length > 0) {
      const values = bikes.map((b) =>
        `('${ts}', '${esc(String(b.bike_id))}', ${b.lat}, ${b.lon}, ${!!b.is_disabled}, ${!!b.is_reserved}, ${b.current_range_meters ?? 'NULL'})`
      ).join(",\n");

      await conn.run(`
        INSERT INTO gbfs_free_bikes VALUES ${values}
      `);
    }

    // Update in-memory cache
    const liveStations: LiveStation[] = [];
    for (const s of statuses) {
      const info = stationInfoMap.get(String(s.station_id));
      if (!info) continue;
      const ebikes = s.vehicle_types_available?.find((v: any) => v.vehicle_type_id === "2")?.count ?? 0;
      liveStations.push({
        ...info,
        num_bikes_available: s.num_bikes_available ?? 0,
        num_ebikes_available: ebikes,
        num_docks_available: s.num_docks_available ?? 0,
        num_bikes_disabled: s.num_bikes_disabled ?? 0,
        num_docks_disabled: s.num_docks_disabled ?? 0,
        is_installed: !!s.is_installed,
        is_renting: !!s.is_renting,
        is_returning: !!s.is_returning,
        last_reported: s.last_reported ?? 0,
      });
    }
    latestStations = liveStations;

    latestFreeBikes = bikes.map((b) => ({
      bike_id: String(b.bike_id),
      lat: b.lat,
      lon: b.lon,
      is_disabled: !!b.is_disabled,
      is_reserved: !!b.is_reserved,
      current_range_meters: b.current_range_meters ?? null,
    }));

    lastPollTime = now;

    // Flush WAL to disk so data survives deploys
    await conn.run("CHECKPOINT");

    console.log(`GBFS poll completed: ${statuses.length} stations, ${bikes.length} free bikes`);
  } catch (err: any) {
    console.error("GBFS poll error:", err.message);
  } finally {
    polling = false;
  }
}

// ─── Poller lifecycle ────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

export async function startGbfsPoller(): Promise<void> {
  await ensureTables();
  console.log("Starting GBFS poller (5-minute interval)...");

  // Initial poll
  await pollCycle();

  pollTimer = setInterval(pollCycle, POLL_INTERVAL_MS);
}

export function stopGbfsPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("GBFS poller stopped.");
  }
}
