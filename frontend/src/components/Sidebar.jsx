import React, { useState, useEffect, useRef } from "react";
import { getStationNames, getRouteLookup } from "../api.js";

function fmt(n) {
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatHour(h) {
  if (h == null) return null;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12} ${ampm}`;
}

// ─── Shared primitives ──────────────────────────────────────────────────────

function Section({ label, description, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full bg-transparent border-none cursor-pointer p-0"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {label}
        </span>
        <span className="text-[10px] text-gray-400 select-none">
          {open ? "\u25B2" : "\u25BC"}
        </span>
      </button>
      {open && description && (
        <p className="text-[10px] text-gray-400 mt-1 mb-0 leading-snug">{description}</p>
      )}
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-black/8 shrink-0" />;
}

function StatRow({ label, value, bold }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-gray-400">{label}</span>
      <span className={bold ? "font-semibold text-purple-600" : "text-gray-900"}>{value}</span>
    </div>
  );
}

// ─── Station autocomplete input ──────────────────────────────────────────────

function StationInput({ value, onChange, placeholder }) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleInput(e) {
    const v = e.target.value;
    setQuery(v);
    onChange("");
    clearTimeout(timer.current);
    if (v.length >= 2) {
      setOpen(true);
      timer.current = setTimeout(async () => {
        try {
          const names = await getStationNames(v);
          setSuggestions(names);
        } catch {
          setSuggestions([]);
        }
      }, 150);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  }

  function pick(name) {
    setQuery(name);
    onChange(name);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={() => { if (query.length >= 2 && suggestions.length) setOpen(true); }}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md bg-white text-gray-900 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/30"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto z-50">
          {suggestions.map((name) => (
            <button
              key={name}
              onMouseDown={() => pick(name)}
              className="w-full text-left px-2.5 py-1.5 text-xs text-gray-900 hover:bg-purple-50 cursor-pointer border-none bg-transparent"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Coverage row (shared by emptiest + best) ───────────────────────────────

function CoverageRow({ s, i, onHoverStation }) {
  const fillPct = Math.min(s.fill_pct, 100);
  const cap = s.capacity || 1;
  const ebikePct = Math.round((s.ebikes / cap) * 100);
  const classicPct = Math.round(((s.bikes - s.ebikes) / cap) * 100);
  return (
    <div
      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded -mx-1 px-1 py-0.5 transition-colors"
      onMouseEnter={() => onHoverStation?.(s.station_id)}
      onMouseLeave={() => onHoverStation?.(null)}
    >
      <span className="w-5 text-right text-[11px] font-semibold text-gray-400 shrink-0">{i + 1}</span>
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className="text-[11px] text-gray-900 truncate" title={s.station_name}>{s.station_name}</span>
        <div className="h-2 rounded-full bg-gray-200 overflow-hidden flex">
          <div className="h-full bg-purple-500" style={{ width: `${ebikePct}%` }} />
          <div className="h-full bg-blue-400" style={{ width: `${classicPct}%` }} />
        </div>
        <div className="flex gap-2 text-[9px]">
          <span className="text-purple-600 font-medium">{s.ebikes} ebike{s.ebikes !== 1 ? "s" : ""}</span>
          <span className="text-blue-500 font-medium">{s.bikes - s.ebikes} classic</span>
          <span className="text-gray-400">{s.docks_available} empty</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={`text-[12px] font-bold ${fillPct === 0 ? "text-red-600" : fillPct < 20 ? "text-red-500" : fillPct < 50 ? "text-amber-600" : "text-green-600"}`}>{fillPct}%</div>
        <div className="text-[9px] text-gray-400">{s.bikes}/{s.capacity}</div>
      </div>
    </div>
  );
}

// ─── Section: Emptiest Stations ──────────────────────────────────────────────

function EmptiestSection({ data, onHoverStation }) {
  return (
    <Section
      label="Emptiest Stations"
      description="Ranked by lowest ebike-to-capacity ratio. Stations with fewer ebikes relative to their size appear first; ties broken by most empty docks."
    >
      <div className="flex flex-col gap-1.5">
        {data.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-2">Waiting for live data...</div>
        )}
        {data.map((s, i) => (
          <CoverageRow key={s.station_id} s={s} i={i} onHoverStation={onHoverStation} />
        ))}
      </div>
    </Section>
  );
}

// ─── Section: Best Coverage ──────────────────────────────────────────────────

function BestCoverageSection({ data, onHoverStation }) {
  return (
    <Section
      label="Best Coverage"
      description="Stations with the highest bike fill rate and most ebikes available."
    >
      <div className="flex flex-col gap-1.5">
        {data.map((s, i) => (
          <CoverageRow key={s.station_id} s={s} i={i} onHoverStation={onHoverStation} />
        ))}
      </div>
    </Section>
  );
}

// ─── Section: Recent Changes ─────────────────────────────────────────────────

function RecentChangesSection({ data, onHoverStation }) {
  return (
    <Section
      label="Recent Changes"
      description="Stations where bike counts changed between the last two snapshots (every 5 min)."
    >
      <div className="flex flex-col gap-1.5">
        {data.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-2">Need 2+ snapshots to show trends.</div>
        )}
        {data.slice(0, 15).map((t) => {
          const gaining = t.bike_delta > 0;
          return (
            <div
              key={t.station_id}
              className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded -mx-1 px-1 py-0.5 transition-colors"
              onMouseEnter={() => onHoverStation?.(t.station_id)}
              onMouseLeave={() => onHoverStation?.(null)}
            >
              <span className={`text-sm shrink-0 ${gaining ? "text-green-600" : "text-red-500"}`}>
                {gaining ? "\u25B2" : "\u25BC"}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-[11px] text-gray-900 truncate block" title={t.station_name}>{t.station_name}</span>
                <div className="flex gap-2 text-[9px] text-gray-400">
                  <span>{t.bikes_now} bikes now</span>
                  <span>{t.ebikes_now} ebikes</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`text-[12px] font-bold ${gaining ? "text-green-600" : "text-red-500"}`}>
                  {gaining ? "+" : ""}{t.bike_delta}
                </div>
                {t.ebike_delta !== 0 && (
                  <div className={`text-[9px] ${t.ebike_delta > 0 ? "text-green-500" : "text-red-400"}`}>
                    {t.ebike_delta > 0 ? "+" : ""}{t.ebike_delta} ebike
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Section: Route Lookup ───────────────────────────────────────────────────

function RouteLookupSection() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function lookup() {
    if (!from || !to) return;
    setLoading(true);
    try {
      setResult(await getRouteLookup(from, to));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    const tmp = from;
    setFrom(to);
    setTo(tmp);
    setResult(null);
  }

  return (
    <Section label="Route Lookup">
      <div className="flex flex-col gap-2">
        <StationInput value={from} onChange={setFrom} placeholder="From station..." />
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-gray-200" />
          <button
            onClick={swap}
            className="text-[10px] text-gray-400 hover:text-purple-600 bg-transparent border border-gray-200 rounded px-1.5 py-0.5 cursor-pointer"
            title="Swap"
          >{"\u21C5"}</button>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <StationInput value={to} onChange={setTo} placeholder="To station..." />
        <button
          onClick={lookup}
          disabled={!from || !to || loading}
          className="w-full py-1.5 text-xs font-semibold text-white bg-purple-600 rounded-md border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-purple-700 transition-colors"
        >
          {loading ? "Searching..." : "Look up"}
        </button>
        {result && result.total_trips > 0 && (
          <div className="flex flex-col gap-1 pt-2 border-t border-gray-100">
            <StatRow label="Trips" value={result.total_trips.toLocaleString()} bold />
            <StatRow label="Return trips" value={result.reverse_trips.toLocaleString()} />
            <StatRow label="Avg duration" value={result.avg_duration_min ? `${result.avg_duration_min} min` : "\u2014"} />
            <StatRow label="Members" value={`${result.member_trips.toLocaleString()} (${Math.round(result.member_trips / result.total_trips * 100)}%)`} />
            <StatRow label="Peak hour" value={formatHour(result.peak_hour) || "\u2014"} />
            <StatRow label="Last trip" value={result.last_trip ? result.last_trip.split(" ")[0] : "\u2014"} />
          </div>
        )}
        {result && result.total_trips === 0 && (
          <div className="text-xs text-gray-400 text-center py-2">No trips found between these stations.</div>
        )}
      </div>
    </Section>
  );
}

// ─── Section: Top Stations ───────────────────────────────────────────────────

function TopStationsSection({ stations, onHoverStation }) {
  const top = (stations || []).slice(0, 10);
  return (
    <Section label="Top Stations" description="Stations with the most departures in the selected time period.">
      <div className="flex flex-col gap-1.5">
        {top.map((s, i) => (
          <div
            key={s.id}
            className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded -mx-1 px-1 py-0.5 transition-colors"
            onMouseEnter={() => onHoverStation?.(s.id)}
            onMouseLeave={() => onHoverStation?.(null)}
          >
            <span className="w-5 text-right text-[11px] font-semibold text-gray-400 shrink-0">{i + 1}</span>
            <div className="flex-1 relative min-h-7 rounded bg-gray-100 flex items-center overflow-hidden" title={s.name}>
              <div
                className="absolute top-0 left-0 bottom-0 rounded bg-gradient-to-r from-purple-400 to-purple-700 opacity-15"
                style={{ width: `${(s.departures / (top[0]?.departures || 1)) * 100}%` }}
              />
              <span className="relative z-1 px-2 py-1 text-[11px] text-gray-900 break-words">{s.name}</span>
            </div>
            <span className="text-[11px] font-semibold text-purple-600 shrink-0 min-w-[40px] text-right">{fmt(s.departures)}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Section: Top Routes ─────────────────────────────────────────────────────

function TopRoutesSection({ flows }) {
  const top = (flows || []).slice(0, 10);
  return (
    <Section label="Top Routes" description="Most popular origin-destination pairs by trip count.">
      <div className="flex flex-col gap-1.5">
        {top.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 text-right text-[11px] font-semibold text-gray-400 shrink-0">{i + 1}</span>
            <div
              className="flex-1 relative min-h-7 rounded bg-gray-100 flex items-center overflow-hidden"
              title={`${f.from_name} \u2192 ${f.to_name}`}
            >
              <div
                className="absolute top-0 left-0 bottom-0 rounded bg-gradient-to-r from-purple-400 to-purple-700 opacity-15"
                style={{ width: `${(f.count / (top[0]?.count || 1)) * 100}%` }}
              />
              <span className="relative z-1 px-2 py-1 text-[11px] text-gray-900 break-words">
                {f.from_name} <span className="text-gray-400">{"\u2192"}</span> {f.to_name}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-purple-600 shrink-0 min-w-[40px] text-right">{fmt(f.count)}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Main sidebar ────────────────────────────────────────────────────────────

export default function Sidebar({ flows, stations, activeLayer, liveCoverage = { emptiest: [], best: [] }, liveTrends = [], onHoverStation }) {
  return (
    <div className="absolute top-[68px] right-0 bottom-0 w-[360px] bg-white/95 backdrop-blur-md border-l border-black/8 shadow-md flex flex-col z-5">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {activeLayer === "live" && (
          <>
            <EmptiestSection data={liveCoverage.emptiest || []} onHoverStation={onHoverStation} />
            <Divider />
            <BestCoverageSection data={liveCoverage.best || []} onHoverStation={onHoverStation} />
            <Divider />
            <RecentChangesSection data={liveTrends} onHoverStation={onHoverStation} />
          </>
        )}
        {activeLayer !== "live" && (
          <>
            <RouteLookupSection />
            <Divider />
            <TopStationsSection stations={stations} onHoverStation={onHoverStation} />
            <Divider />
            <TopRoutesSection flows={flows} />
          </>
        )}
      </div>
    </div>
  );
}
