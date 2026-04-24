import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { groupIntoAreas } from "../lib/rebalance-areas";

// Fixed at 24h for now. Longer windows (3d/7d) were crashing the server on
// a 2 GB VM — SQL-side interval detection would unblock it.
const WINDOW_HOURS = 24;

function fmtDollars(n) {
  return "$" + Math.round(n).toLocaleString();
}

function fmtMinutes(n) {
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return "just now";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtPT(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function fmtDistance(m) {
  if (m < 160) return `${m} m`;
  return `${(m / 1609.344).toFixed(2)} mi`;
}

export default function RebalanceViolationsSection({ onClickStation }) {
  const showRebalance = useStore((s) => s.showRebalance);
  const setShowRebalance = useStore((s) => s.setShowRebalance);
  const kpi = useStore((s) => s.rebalancingKpi);
  const loading = useStore((s) => s.rebalancingLoading);
  const loadRebalancingKpi = useStore((s) => s.loadRebalancingKpi);
  const setHighlightedAreaKey = useStore((s) => s.setHighlightedAreaKey);
  const [expandedId, setExpandedId] = useState(null);

  // Fetch when section becomes active; refresh every 60s while active.
  useEffect(() => {
    if (!showRebalance) return;
    loadRebalancingKpi(WINDOW_HOURS);
    const t = setInterval(() => loadRebalancingKpi(WINDOW_HOURS), 60_000);
    return () => clearInterval(t);
  }, [showRebalance]);

  // Group per-station Clusters into Violation Areas so overlapping near-
  // duplicates collapse into one row. Penalty sums are preserved.
  const allAreas = groupIntoAreas(kpi?.by_station ?? []);
  const topAreas = allAreas.slice(0, 15);
  const windowLabel = kpi
    ? `${fmtPT(kpi.from_ts)} → ${fmtPT(kpi.to_ts)} PT`
    : "—";

  return (
    <div>
      {/* Header + button */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Cluster Outages
        </span>
        {kpi && showRebalance && (
          <button
            onClick={() => loadRebalancingKpi(WINDOW_HOURS)}
            className="text-[11px] text-purple-600 hover:text-purple-700 cursor-pointer bg-transparent border-none"
            title="Refresh"
          >
            {loading ? "…" : "↻"}
          </button>
        )}
      </div>
      <p className="text-[10px] text-gray-400 leading-snug mb-2">
        Reblanace violations are when there are no bikes or free docks at any
        station in the cluster for {">"} 10 min during Peak Hours (6a–10p PT).
        Penalty: $1/min beyond 10 min. This is defined {" "}
        <a
          href="https://www.paloalto.gov/files/assets/public/v/1/agendas-minutes-reports/reports/city-manager-reports-cmrs/year-archive/2016/id-6916.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          here
        </a>
        .
      </p>
      <p className="text-[10px] text-gray-400 leading-snug mb-2 italic"> This is an experimental feature </p>

      {/* Toggle button */}
      <button
        onClick={() => setShowRebalance(!showRebalance)}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded-md border cursor-pointer transition-all mb-2
          ${
            showRebalance
              ? "bg-red-600/10 border-red-600/40 text-red-600 font-semibold"
              : "border-black/10 bg-transparent text-gray-500 hover:border-red-600/30 hover:text-red-600"
          }`}
      >
        <span>
          {showRebalance
            ? "Hide rebalance violations"
            : "See all rebalance violations"}
        </span>
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: "rgb(220, 38, 38)" }}
        />
      </button>

      {/* Expanded content */}
      {showRebalance && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-gray-500 truncate">
            {windowLabel}
          </div>

          {/* Totals grid */}
          <div className="grid grid-cols-3 gap-2 p-2 bg-black/3 rounded-md">
            <Stat
              label="Penalty"
              value={kpi ? fmtDollars(kpi.total_penalty_dollars) : "—"}
              tone="red"
            />
            <Stat
              label="Events"
              value={kpi ? String(kpi.total_outage_events) : "—"}
            />
            <Stat
              label="Areas"
              value={kpi ? String(allAreas.length) : "—"}
              sub={kpi ? `${kpi.affected_cluster_count} clusters` : undefined}
            />
            <Stat
              label="Empty $"
              value={kpi ? fmtDollars(kpi.empty_penalty_dollars) : "—"}
              sub={
                kpi && kpi.total_penalty_dollars
                  ? `${Math.round((kpi.empty_penalty_dollars / kpi.total_penalty_dollars) * 100)}%`
                  : undefined
              }
            />
            <Stat
              label="Full $"
              value={kpi ? fmtDollars(kpi.full_penalty_dollars) : "—"}
              sub={
                kpi && kpi.total_penalty_dollars
                  ? `${Math.round((kpi.full_penalty_dollars / kpi.total_penalty_dollars) * 100)}%`
                  : undefined
              }
            />
            <Stat
              label="Avg / worst"
              value={
                kpi
                  ? `${Math.round(kpi.avg_outage_minutes)}/${Math.round(kpi.worst_outage_minutes)}m`
                  : "—"
              }
            />
          </div>

          {/* Violation areas list */}
          <div className="flex flex-col gap-1 mt-1">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 flex justify-between">
              <span>Violation area</span>
              <span>penalty</span>
            </div>
            {topAreas.length === 0 && !loading && (
              <div className="text-gray-400 py-2 text-center text-[11px]">
                No qualifying outages in this window.
              </div>
            )}
            {loading && topAreas.length === 0 && (
              <div className="text-gray-400 py-2 text-center text-[11px]">
                Loading…
              </div>
            )}
            {topAreas.map((a, i) => {
              const expanded = expandedId === a.key;
              const preview =
                a.stations
                  .slice(0, 2)
                  .map((x) => x.station_name)
                  .join(" · ") +
                (a.stations.length > 2 ? ` · +${a.stations.length - 2}` : "");
              return (
                <div
                  key={a.key}
                  className="rounded-md border border-black/5 overflow-hidden"
                  onMouseEnter={() => setHighlightedAreaKey(a.key)}
                  onMouseLeave={() => setHighlightedAreaKey(null)}
                >
                  <button
                    onClick={() => setExpandedId(expanded ? null : a.key)}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-red-600/5 cursor-pointer text-left bg-transparent border-none"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-800 font-medium flex items-center gap-1.5">
                        <span
                          className={`inline-block transition-transform text-gray-400 text-[9px] ${expanded ? "rotate-90" : ""}`}
                        >
                          ▸
                        </span>
                        <span>Area #{i + 1}</span>
                        <span className="text-[10px] text-gray-400 font-normal truncate">
                          · {a.stations.length} stations · {a.cluster_count}{" "}
                          cluster{a.cluster_count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate ml-3 mt-0.5">
                        {preview}
                      </div>
                      <div className="text-[9px] text-gray-400 flex gap-2 mt-0.5 ml-3 flex-wrap">
                        <span>{a.outage_count} outages</span>
                        <span title="bikes=0 across entire cluster">
                          empty {fmtMinutes(a.empty_minutes)}
                        </span>
                        {a.full_minutes > 0 && (
                          <span title="docks=0 across entire cluster">
                            full {fmtMinutes(a.full_minutes)}
                          </span>
                        )}
                        <span>{fmtRelative(a.last_outage_end)}</span>
                      </div>
                    </div>
                    <div className="text-[11px] font-semibold text-red-600 tabular-nums shrink-0">
                      {fmtDollars(a.penalty_dollars)}
                    </div>
                  </button>
                  {expanded && (
                    <div className="px-2 pb-2 pt-0.5 bg-black/2 border-t border-black/5">
                      <div className="text-[9px] uppercase tracking-wider text-gray-400 mb-1 mt-1">
                        Stations in this area
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {a.stations.map((m) => (
                          <button
                            key={m.station_id}
                            onClick={() => onClickStation?.(m.station_id)}
                            className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-white cursor-pointer text-left bg-transparent border-none"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                              <span className="text-[10px] text-gray-700 truncate">
                                {m.station_name}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span
        className={`text-sm font-semibold tabular-nums ${tone === "red" ? "text-red-600" : "text-gray-800"}`}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[9px] text-gray-400 tabular-nums">{sub}</span>
      )}
    </div>
  );
}
