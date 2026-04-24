// Shared color definitions for live station fill level and transit systems.
// deck.gl wants [r,g,b,a] arrays; CSS / JSX wants rgb() strings — we keep
// both so callers don't have to convert.

// ─── Station fill level (by ebike-to-capacity ratio) ────────────────────────

export interface FillLevel {
  threshold: number;
  color: [number, number, number, number]; // deck.gl RGBA
  rgb: string;                               // CSS string
  label: string;
}

export const STATION_FILL_LEVELS: FillLevel[] = [
  { threshold: 0.5,  color: [34, 197, 94, 200],  rgb: "rgb(34, 197, 94)",   label: "50%+" },
  { threshold: 0.25, color: [234, 179, 8, 200],  rgb: "rgb(234, 179, 8)",   label: "25-50%" },
  { threshold: 0.1,  color: [249, 115, 22, 200], rgb: "rgb(249, 115, 22)",  label: "10-25%" },
  { threshold: 0,    color: [220, 38, 38, 200],  rgb: "rgb(220, 38, 38)",   label: "<10%" },
];

const UNKNOWN_FILL: [number, number, number, number] = [150, 150, 150, 180];

export function stationFillColor(station: { capacity?: number; num_ebikes_available?: number }): [number, number, number, number] {
  const cap = station.capacity ?? 0;
  if (!cap) return UNKNOWN_FILL;
  const ratio = (station.num_ebikes_available ?? 0) / cap;
  for (const lvl of STATION_FILL_LEVELS) {
    if (ratio >= lvl.threshold) return lvl.color;
  }
  return STATION_FILL_LEVELS[STATION_FILL_LEVELS.length - 1].color;
}

// ─── Transit systems (BART, Caltrain, Muni) ─────────────────────────────────
// GBFS / MTC tag agencies under two alternate names each. We normalize via
// agencies[] so callers can key off whichever name comes in.

export interface TransitSystem {
  label: string;
  color: [number, number, number, number];
  rgb: string;
  agencies: string[];
}

export const TRANSIT_SYSTEMS: TransitSystem[] = [
  {
    label: "BART",
    color: [30, 58, 138, 230],
    rgb: "rgb(30, 58, 138)",
    agencies: [
      "San Francisco Bay Area Rapid Transit District",
      "Bay Area Rapid Transit",
    ],
  },
  {
    label: "Caltrain",
    color: [219, 39, 119, 230],
    rgb: "rgb(219, 39, 119)",
    agencies: [
      "Peninsula Corridor Joint Powers Board",
      "Caltrain",
    ],
  },
  {
    label: "Muni",
    color: [15, 118, 110, 230],
    rgb: "rgb(15, 118, 110)",
    agencies: [
      "City and County of San Francisco",
      "San Francisco Municipal Transportation Agency",
    ],
  },
];

const TRANSIT_BY_AGENCY = new Map<string, TransitSystem>();
for (const sys of TRANSIT_SYSTEMS) for (const a of sys.agencies) TRANSIT_BY_AGENCY.set(a, sys);

const TRANSIT_DEFAULT_COLOR: [number, number, number, number] = [120, 120, 120, 180];

export function transitColor(agency: string): [number, number, number, number] {
  return TRANSIT_BY_AGENCY.get(agency)?.color ?? TRANSIT_DEFAULT_COLOR;
}

export function transitLabel(agency: string): string {
  return TRANSIT_BY_AGENCY.get(agency)?.label ?? agency;
}
