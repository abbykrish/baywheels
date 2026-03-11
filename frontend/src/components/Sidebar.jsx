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

function SectionToggle({ label, open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-between w-full bg-transparent border-none cursor-pointer p-0"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span className="text-[10px] text-gray-400 select-none">
        {open ? "\u25B2" : "\u25BC"}
      </span>
    </button>
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
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md bg-white text-gray-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto z-50">
          {suggestions.map((name) => (
            <button
              key={name}
              onMouseDown={() => pick(name)}
              className="w-full text-left px-2.5 py-1.5 text-xs text-gray-900 hover:bg-blue-50 cursor-pointer border-none bg-transparent"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main sidebar ────────────────────────────────────────────────────────────
export default function Sidebar({ flows, stations }) {
  const [stationsOpen, setStationsOpen] = useState(true);
  const [routesOpen, setRoutesOpen] = useState(true);
  const [lookupOpen, setLookupOpen] = useState(true);

  const topStations = (stations || []).slice(0, 10);
  const topRoutes = (flows || []).slice(0, 10);

  // Route lookup state
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
    <div className="absolute top-[68px] right-0 bottom-0 w-[360px] bg-white/95 backdrop-blur-md border-l border-black/8 shadow-md flex flex-col z-5">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">

        {/* ── Route Lookup ── */}
        <div>
          <SectionToggle label="Route Lookup" open={lookupOpen} onToggle={() => setLookupOpen(!lookupOpen)} />
          {lookupOpen && (
            <div className="mt-2 flex flex-col gap-2">
              <StationInput value={from} onChange={setFrom} placeholder="From station..." />
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-200" />
                <button
                  onClick={swap}
                  className="text-[10px] text-gray-400 hover:text-blue-600 bg-transparent border border-gray-200 rounded px-1.5 py-0.5 cursor-pointer"
                  title="Swap"
                >{"\u21C5"}</button>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <StationInput value={to} onChange={setTo} placeholder="To station..." />
              <button
                onClick={lookup}
                disabled={!from || !to || loading}
                className="w-full py-1.5 text-xs font-semibold text-white bg-blue-700 rounded-md border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-800 transition-colors"
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
          )}
        </div>

        <div className="h-px bg-black/8 shrink-0" />

        {/* ── Top Stations ── */}
        <div>
          <SectionToggle label="Top Stations" open={stationsOpen} onToggle={() => setStationsOpen(!stationsOpen)} />
          {stationsOpen && (
            <div className="mt-2 flex flex-col gap-1.5">
              {topStations.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="w-5 text-right text-[11px] font-semibold text-gray-400 shrink-0">{i + 1}</span>
                  <div className="flex-1 relative min-h-7 rounded bg-gray-100 flex items-center overflow-hidden" title={s.name}>
                    <div
                      className="absolute top-0 left-0 bottom-0 rounded bg-gradient-to-r from-blue-400 to-blue-700 opacity-15"
                      style={{ width: `${(s.departures / (topStations[0]?.departures || 1)) * 100}%` }}
                    />
                    <span className="relative z-1 px-2 py-1 text-[11px] text-gray-900 break-words">{s.name}</span>
                  </div>
                  <span className="text-[11px] font-semibold text-blue-700 shrink-0 min-w-[40px] text-right">{fmt(s.departures)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-black/8 shrink-0" />

        {/* ── Top Routes ── */}
        <div>
          <SectionToggle label="Top Routes" open={routesOpen} onToggle={() => setRoutesOpen(!routesOpen)} />
          {routesOpen && (
            <div className="mt-2 flex flex-col gap-1.5">
              {topRoutes.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-right text-[11px] font-semibold text-gray-400 shrink-0">{i + 1}</span>
                  <div
                    className="flex-1 relative min-h-7 rounded bg-gray-100 flex items-center overflow-hidden"
                    title={`${f.from_name} \u2192 ${f.to_name}`}
                  >
                    <div
                      className="absolute top-0 left-0 bottom-0 rounded bg-gradient-to-r from-blue-400 to-blue-700 opacity-15"
                      style={{ width: `${(f.count / (topRoutes[0]?.count || 1)) * 100}%` }}
                    />
                    <span className="relative z-1 px-2 py-1 text-[11px] text-gray-900 break-words">
                      {f.from_name} <span className="text-gray-400">{"\u2192"}</span> {f.to_name}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-blue-700 shrink-0 min-w-[40px] text-right">{fmt(f.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, bold }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-gray-400">{label}</span>
      <span className={bold ? "font-semibold text-blue-700" : "text-gray-900"}>{value}</span>
    </div>
  );
}
