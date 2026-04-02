const BASE = "/api";

async function fetchJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function getStats(start, end) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return fetchJSON(`/stats${qs ? `?${qs}` : ""}`);
}

export function getFlows(start, end, limit = 200) {
  const params = new URLSearchParams({ limit });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return fetchJSON(`/flows?${params}`);
}

export function getStations(start, end) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return fetchJSON(`/stations${qs ? `?${qs}` : ""}`);
}

export function getStationNames(q) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  return fetchJSON(`/station-names?${params}`);
}

export function getRouteLookup(from, to) {
  const params = new URLSearchParams({ from, to });
  return fetchJSON(`/route-lookup?${params}`);
}

export function getMonths() {
  return fetchJSON("/months");
}

export function getHourly(start, end) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return fetchJSON(`/hourly${qs ? `?${qs}` : ""}`);
}

// ─── Live GBFS endpoints ────────────────────────────────────────────────────

export function getLiveStations() {
  return fetchJSON("/live/stations");
}

export function getLiveBikes() {
  return fetchJSON("/live/bikes");
}

export function getLiveMeta() {
  return fetchJSON("/live/meta");
}

export function getLiveCoverage(limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJSON(`/live/coverage?${params}`);
}

export function getLiveTrends(minutes = 5) {
  const params = new URLSearchParams({ minutes: String(minutes) });
  return fetchJSON(`/live/trends?${params}`);
}


export function getStationHistory(stationId, hours = 24) {
  const params = new URLSearchParams({ hours: String(hours) });
  return fetchJSON(`/station-history/${encodeURIComponent(stationId)}?${params}`);
}

export function getStationLastEbike(stationId) {
  return fetchJSON(`/station-last-ebike/${encodeURIComponent(stationId)}`);
}
