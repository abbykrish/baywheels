import React, { useState, useEffect, useRef } from "react";
import { getStationNames, getRouteLookup } from "../api";
import MonthFilter from "./MonthFilter";
import HourlyChart from "./HourlyChart";

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
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

function CoverageRow({ s, i, onHoverStation, onClickStation = null }) {
  const fillPct = Math.min(s.fill_pct, 100);
  const cap = s.capacity || 1;
  const ebikePct = Math.round((s.ebikes / cap) * 100);
  const classicPct = Math.round(((s.bikes - s.ebikes) / cap) * 100);
  return (
    <div
      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded -mx-1 px-1 py-0.5 transition-colors"
      onMouseEnter={() => onHoverStation?.(s.station_id)}
      onMouseLeave={() => onHoverStation?.(null)}
      onClick={() => onClickStation?.(s.station_id)}
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
        {s.pct_time_empty != null ? (
          <>
            <div className={`text-[12px] font-bold ${s.pct_time_empty >= 50 ? "text-red-600" : s.pct_time_empty >= 20 ? "text-amber-600" : "text-green-600"}`}>{s.pct_time_empty}%</div>
            <div className="text-[9px] text-gray-400">empty (24h)</div>
          </>
        ) : (
          <>
            <div className={`text-[12px] font-bold ${fillPct === 0 ? "text-red-600" : fillPct < 20 ? "text-red-500" : fillPct < 50 ? "text-amber-600" : "text-green-600"}`}>{fillPct}%</div>
            <div className="text-[9px] text-gray-400">{s.bikes}/{s.capacity}</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Section: Emptiest Stations ──────────────────────────────────────────────

function EmptiestSection({ data, onHoverStation, onClickStation = null }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? data : data.slice(0, 5);
  return (
    <Section
      label="Emptiest Stations"
      description="Ranked by % of time with 0 ebikes over the last 24 hours. Stations that spend the most time empty appear first."
    >
      <div className="flex flex-col gap-1.5">
        {data.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-2">Waiting for live data...</div>
        )}
        {visible.map((s, i) => (
          <CoverageRow key={s.station_id} s={s} i={i} onHoverStation={onHoverStation} onClickStation={onClickStation} />
        ))}
        {data.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-purple-600 font-medium bg-transparent border-none cursor-pointer py-1 hover:underline"
          >
            {expanded ? "Show less" : `Show all ${data.length}`}
          </button>
        )}
      </div>
    </Section>
  );
}

// ─── Section: Best Coverage ──────────────────────────────────────────────────

function BestCoverageSection({ data, onHoverStation, onClickStation = null }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? data : data.slice(0, 5);
  return (
    <Section
      label="Best Coverage"
      description="Stations that spent the least time empty over the last 24 hours."
    >
      <div className="flex flex-col gap-1.5">
        {visible.map((s, i) => (
          <CoverageRow key={s.station_id} s={s} i={i} onHoverStation={onHoverStation} onClickStation={onClickStation} />
        ))}
        {data.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-purple-600 font-medium bg-transparent border-none cursor-pointer py-1 hover:underline"
          >
            {expanded ? "Show less" : `Show all ${data.length}`}
          </button>
        )}
      </div>
    </Section>
  );
}

// ─── Section: Recent Changes ─────────────────────────────────────────────────

function DeltaBadge({ delta, label }) {
  if (delta === 0) return null;
  const gaining = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${gaining ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
      {gaining ? "\u25B2" : "\u25BC"} {gaining ? "+" : ""}{delta} {label}
    </span>
  );
}

function RecentChangesSection({ data, onHoverStation, onClickStation = null }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? data : data.slice(0, 5);
  return (
    <Section
      label="Recent Changes"
      description="Stations where bike counts changed in the last 5 minutes."
    >
      <div className="flex flex-col gap-1.5">
        {data.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-2">Need 2+ snapshots to show trends.</div>
        )}
        {visible.map((t) => {
          const gaining = t.bike_delta > 0;
          const classics = Math.max(0, t.bikes_now - t.ebikes_now);
          const total = t.bikes_now + (t.docks_now || 0);
          const cap = total || 1;
          const ebikePct = Math.round((t.ebikes_now / cap) * 100);
          const classicPct = Math.round((classics / cap) * 100);
          return (
            <div
              key={t.station_id}
              className="cursor-pointer hover:bg-gray-50 rounded -mx-1 px-1 py-1 transition-colors"
              onMouseEnter={() => onHoverStation?.(t.station_id)}
              onMouseLeave={() => onHoverStation?.(null)}
              onClick={() => onClickStation?.(t.station_id)}
            >
              <div className="flex items-center gap-2">
                <span className={`text-sm shrink-0 ${gaining ? "text-green-600" : "text-red-500"}`}>
                  {gaining ? "\u25B2" : "\u25BC"}
                </span>
                <span className="text-[11px] text-gray-900 truncate flex-1" title={t.station_name}>{t.station_name}</span>
              </div>
              <div className="ml-6 mt-1">
                <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden flex">
                  <div className="h-full bg-purple-500" style={{ width: `${ebikePct}%` }} />
                  <div className="h-full bg-blue-400" style={{ width: `${classicPct}%` }} />
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[10px] text-purple-600 font-medium">{t.ebikes_now} ebike{t.ebikes_now !== 1 ? "s" : ""}</span>
                  <span className="text-[10px] text-blue-500 font-medium">{classics} classic</span>
                  <span className="text-[10px] text-gray-300">|</span>
                  <DeltaBadge delta={t.ebike_delta} label="ebike" />
                  <DeltaBadge delta={t.bike_delta - t.ebike_delta} label="classic" />
                </div>
              </div>
            </div>
          );
        })}
        {data.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-purple-600 font-medium bg-transparent border-none cursor-pointer py-1 hover:underline"
          >
            {expanded ? "Show less" : `Show all ${data.length}`}
          </button>
        )}
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

function TopRoutesSection({ flows, onHoverRoute }) {
  const top = (flows || []).slice(0, 10);
  return (
    <Section label="Top Routes" description="Most popular origin-destination pairs by trip count.">
      <div className="flex flex-col gap-1.5" onMouseLeave={() => onHoverRoute?.(null)}>
        {top.map((f, i) => (
          <div key={i} className="flex items-center gap-2 cursor-pointer" onMouseEnter={() => onHoverRoute?.(f)}>
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

// ─── SLA sections ───────────────────────────────────────────────────────────

function formatDuration(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function formatSlaTime(ts) {
  if (!ts) return "Ongoing";
  try {
    const d = new Date(ts.replace(" ", "T") + "Z");
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return ts; }
}

function SLASummarySection({ slaData }) {
  const clusters = slaData.clusters?.summary;
  const dist = slaData.distribution?.summary;
  const fleet = slaData.fleet?.summary;
  const totalPenalty = (clusters?.total_penalty || 0);
  const totalViolations = (clusters?.total_violations || 0) + (dist?.total_violations || 0) + (fleet?.days_in_violation || 0);
  const activeViolations = (clusters?.active_violations || 0) + (dist?.active_violations || 0);

  return (
    <Section label="SLA Summary (24h)" description="Contract compliance based on Lyft's Bay Wheels agreement with MTC.">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-red-50 rounded-lg px-3 py-2 text-center">
          <div className="text-lg font-bold text-red-600">{totalViolations}</div>
          <div className="text-[9px] text-gray-400 uppercase">Violations</div>
        </div>
        <div className="bg-red-50 rounded-lg px-3 py-2 text-center">
          <div className="text-lg font-bold text-red-600">{activeViolations}</div>
          <div className="text-[9px] text-gray-400 uppercase">Active Now</div>
        </div>
        <div className="bg-orange-50 rounded-lg px-3 py-2 text-center">
          <div className="text-lg font-bold text-orange-600">${totalPenalty}</div>
          <div className="text-[9px] text-gray-400 uppercase">Cluster Penalties</div>
        </div>
        <div className={`rounded-lg px-3 py-2 text-center ${fleet?.current_pct >= 90 ? "bg-green-50" : "bg-red-50"}`}>
          <div className={`text-lg font-bold ${fleet?.current_pct >= 90 ? "text-green-600" : "text-red-600"}`}>{fleet?.current_pct ?? "--"}%</div>
          <div className="text-[9px] text-gray-400 uppercase">Fleet Avail.</div>
        </div>
      </div>
    </Section>
  );
}

function ClusterOutageSection({ data }) {
  const [expanded, setExpanded] = useState(false);
  const clusters = data?.clusters || [];
  const visible = expanded ? clusters : clusters.slice(0, 5);

  return (
    <Section
      label={`Cluster Outages (${clusters.length})`}
      description="KPI #12: No cluster fully empty of bikes or docks for 10+ min during 6AM-10PM. Penalty: $1/min after 10 min."
    >
      <div className="flex flex-col gap-2">
        {clusters.length === 0 && (
          <div className="text-xs text-green-600 text-center py-2">No cluster outages in last 24h</div>
        )}
        {visible.map((cluster) => (
          <div key={cluster.key} className="bg-red-50/50 rounded-lg px-3 py-2">
            <div className="text-[11px] font-medium text-gray-900 truncate" title={cluster.station_names.join(", ")}>
              {cluster.station_names[0]} +{cluster.station_ids.length - 1}
            </div>
            <div className="flex flex-col gap-0.5 mt-1">
              {cluster.violations.slice(-3).map((v, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className={`font-semibold ${v.ended_at === null ? "text-red-600" : "text-orange-600"}`}>
                    {v.ended_at === null ? "ACTIVE" : formatDuration(v.duration_minutes)}
                  </span>
                  <span className="text-gray-500">{formatSlaTime(v.started_at)}</span>
                  <span className="text-gray-400">{v.type === "no_bikes" ? "no bikes" : "no docks"}</span>
                  <span className="text-red-500 ml-auto">${v.penalty_dollars}</span>
                </div>
              ))}
            </div>
            {cluster.violations.length > 3 && (
              <div className="text-[9px] text-gray-400 mt-1">+{cluster.violations.length - 3} more violations</div>
            )}
          </div>
        ))}
        {clusters.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-purple-600 font-medium bg-transparent border-none cursor-pointer py-1 hover:underline">
            {expanded ? "Show less" : `Show all ${clusters.length}`}
          </button>
        )}
      </div>
    </Section>
  );
}

function DistributionSection({ data }) {
  const [expanded, setExpanded] = useState(false);
  const violations = data?.violations || [];
  const visible = expanded ? violations : violations.slice(0, 5);

  return (
    <Section
      label={`Distribution Violations (${violations.length})`}
      description="No station shall be completely empty or full for 3+ hours during 6AM-10PM."
    >
      <div className="flex flex-col gap-1.5">
        {violations.length === 0 && (
          <div className="text-xs text-green-600 text-center py-2">No distribution violations in last 24h</div>
        )}
        {visible.map((v, i) => (
          <div key={i} className="flex items-center gap-2 hover:bg-gray-50 rounded -mx-1 px-1 py-0.5">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${v.type === "empty" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
              {v.type === "empty" ? "EMPTY" : "FULL"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-gray-900 truncate" title={v.station_name}>{v.station_name}</div>
              <div className="text-[9px] text-gray-400">
                {formatDuration(v.duration_minutes)} &middot; {formatSlaTime(v.started_at)}
                {v.ended_at === null && <span className="text-red-500 font-semibold ml-1">ACTIVE</span>}
              </div>
            </div>
          </div>
        ))}
        {violations.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-purple-600 font-medium bg-transparent border-none cursor-pointer py-1 hover:underline">
            {expanded ? "Show less" : `Show all ${violations.length}`}
          </button>
        )}
      </div>
    </Section>
  );
}

function FleetAvailabilitySection({ data }) {
  const daily = data?.daily || [];
  const summary = data?.summary;
  if (!daily.length) return null;

  const W = 300, H = 80;
  const PAD = { left: 30, right: 8, top: 8, bottom: 16 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const barW = Math.max(8, cw / daily.length - 2);

  return (
    <Section
      label="Fleet Availability"
      description="At least 90% of bikes must be operational and on-street. Measured daily 11AM-3PM."
    >
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 text-[10px]">
          <span className="text-gray-400">Current:</span>
          <span className={`font-semibold ${summary?.current_pct >= 90 ? "text-green-600" : "text-red-600"}`}>
            {summary?.current_pct}% ({summary?.current_available}/{summary?.current_total} bikes)
          </span>
        </div>
        <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`}>
          {/* 90% threshold line */}
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + ch * 0.1} y2={PAD.top + ch * 0.1} stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" />
          <text x={PAD.left - 4} y={PAD.top + ch * 0.1 + 3} fill="#ef4444" fontSize="8" textAnchor="end">90%</text>

          {daily.map((d, i) => {
            const x = PAD.left + (i / daily.length) * cw;
            const pct = Math.min(d.pct_available, 100);
            const barH = (pct / 100) * ch;
            return (
              <g key={i}>
                <rect x={x} y={PAD.top + ch - barH} width={barW} height={barH} rx={2}
                  fill={d.in_violation ? "#ef4444" : "#22c55e"} opacity={0.7} />
                <text x={x + barW / 2} y={H - 3} fill="#9ca3af" fontSize="7" textAnchor="middle">
                  {new Date(d.date).toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
                </text>
              </g>
            );
          })}
        </svg>
        {summary?.days_in_violation > 0 && (
          <div className="text-[10px] text-red-500">{summary.days_in_violation} of {summary.days_measured} days below 90% threshold</div>
        )}
      </div>
    </Section>
  );
}

// ─── Main sidebar ────────────────────────────────────────────────────────────

export default function Sidebar({ flows, stations, activeLayer, liveCoverage = { emptiest: [], best: [] }, liveTrends = [], onHoverStation, onHoverRoute, onClickStation, liveStations = [], slaData = { clusters: null, distribution: null, fleet: null }, sidebarOpen = false, onClose, hourly = [], months = [], selectedMonth = "all", onMonthChange, arcCount = 200, onArcCountChange }) {
  // Look up full live station object by station_id and fire onClickStation
  function handleStationClick(stationId) {
    if (!onClickStation) return;
    const s = liveStations.find((s) => s.station_id === stationId);
    if (s) onClickStation(s);
  }

  return (
    <div className={`absolute top-[86px] md:top-[68px] right-0 bottom-0 w-[85vw] max-w-[360px] bg-white/95 backdrop-blur-md border-l border-black/8 shadow-md flex flex-col z-15 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "translate-x-full pointer-events-none"} md:translate-x-0 md:pointer-events-auto`}>
      {/* Mobile drag handle */}
      <div className="md:hidden flex justify-center pt-2 pb-1" onClick={onClose}>
        <div className="w-8 h-1 rounded-full bg-gray-300" />
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2 md:pt-4 flex flex-col gap-5">
        {/* Mobile-only: month filter + arc count */}
        {activeLayer !== "live" && activeLayer !== "sla" && (
          <div className="md:hidden flex flex-col gap-3">
            <MonthFilter months={months} selected={selectedMonth} onChange={onMonthChange} />
            {activeLayer === "arcs" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-wide text-gray-400">Top Routes</label>
                <div className="flex gap-1">
                  {[50, 100, 200, 500].map((n) => (
                    <button
                      key={n}
                      onClick={() => onArcCountChange?.(n)}
                      className={`flex-1 py-1.5 text-xs rounded-md border cursor-pointer transition-all ${
                        arcCount === n
                          ? "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold"
                          : "border-black/10 bg-transparent text-gray-500"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <HourlyChart data={hourly} />
            <Divider />
          </div>
        )}
        {activeLayer === "live" && (
          <>
<EmptiestSection data={liveCoverage.emptiest || []} onHoverStation={onHoverStation} onClickStation={handleStationClick} />
            <Divider />
            <BestCoverageSection data={liveCoverage.best || []} onHoverStation={onHoverStation} onClickStation={handleStationClick} />
            <Divider />
            <RecentChangesSection data={liveTrends} onHoverStation={onHoverStation} onClickStation={handleStationClick} />
          </>
        )}
        {activeLayer === "sla" && (
          <>
            <SLASummarySection slaData={slaData} />
            <Divider />
            <ClusterOutageSection data={slaData.clusters} />
            <Divider />
            <DistributionSection data={slaData.distribution} />
            <Divider />
            <FleetAvailabilitySection data={slaData.fleet} />
          </>
        )}
        {activeLayer !== "live" && activeLayer !== "sla" && (
          <>
            <RouteLookupSection />
            <Divider />
            <TopStationsSection stations={stations} onHoverStation={onHoverStation} />
            <Divider />
            <TopRoutesSection flows={flows} onHoverRoute={onHoverRoute} />
          </>
        )}
      </div>
    </div>
  );
}
