import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getStationHistory, getStationLastEbike } from "../api";

interface HistoryPoint {
  ts: string;
  bikes: number;
  ebikes: number;
  docks: number;
}

interface Station {
  station_id: string;
  name: string;
  capacity: number;
  num_bikes_available: number;
  num_ebikes_available: number;
  num_docks_available: number;
  is_renting: boolean;
  is_returning: boolean;
}

interface Props {
  station: Station | null;
  onClose: () => void;
}

function formatTime(ts: string, showDate = false) {
  try {
    const d = new Date(ts.replace(" ", "T") + "Z");
    if (showDate) return d.toLocaleDateString([], { month: "short", day: "numeric" });
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return ts;
  }
}

type ChartFilter = "all" | "ebikes" | "classics";

function downsample(data: HistoryPoint[], maxPoints: number): HistoryPoint[] {
  if (data.length <= maxPoints) return data;
  const step = data.length / maxPoints;
  const result: HistoryPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    const chunk = data.slice(start, end);
    if (!chunk.length) continue;
    // Use average values for smoother lines
    const avg = {
      ts: chunk[Math.floor(chunk.length / 2)].ts,
      bikes: Math.round(chunk.reduce((s, d) => s + d.bikes, 0) / chunk.length),
      ebikes: Math.round(chunk.reduce((s, d) => s + d.ebikes, 0) / chunk.length),
      docks: Math.round(chunk.reduce((s, d) => s + d.docks, 0) / chunk.length),
    };
    result.push(avg);
  }
  return result;
}

function MiniChart({ history, capacity, showDate = false }: { history: HistoryPoint[]; capacity: number; showDate?: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<ChartFilter>("all");
  const svgRef = useRef<SVGSVGElement>(null);

  if (!history.length) {
    return <div className="text-xs text-gray-400 text-center py-4">No snapshot history yet.</div>;
  }

  // Downsample to ~200 points for readability
  const data = downsample(history, 200);

  const classics = data.map((d) => d.bikes - d.ebikes);
  const maxY = Math.max(
    capacity,
    ...data.map((d, i) =>
      filter === "ebikes" ? d.ebikes : filter === "classics" ? classics[i] : d.bikes
    ),
    1,
  );
  const W = 400;
  const H = showDate ? 160 : 130;
  const PAD = { top: 8, right: 12, bottom: 20, left: 28 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (data.length - 1)) * cw;
  const y = (v: number) => PAD.top + ch - (v / maxY) * ch;

  const ebikeLine = data.map((d, i) => `${x(i)},${y(d.ebikes)}`).join(" ");
  const bikeLine = data.map((d, i) => `${x(i)},${y(d.bikes)}`).join(" ");
  const classicLine = data.map((d, i) => `${x(i)},${y(classics[i])}`).join(" ");

  const yTicks: number[] = [];
  const step = maxY <= 10 ? 2 : maxY <= 30 ? 5 : 10;
  for (let v = 0; v <= maxY; v += step) yTicks.push(v);

  const labelCount = showDate ? 5 : 4;
  const xLabels: { i: number; label: string }[] = [];
  for (let n = 0; n < labelCount; n++) {
    const i = Math.round((n / (labelCount - 1)) * (data.length - 1));
    xLabels.push({ i, label: formatTime(data[i].ts, showDate) });
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (svgX - PAD.left) / cw;
    const idx = Math.round(ratio * (data.length - 1));
    if (idx >= 0 && idx < data.length) setHoverIdx(idx);
    else setHoverIdx(null);
  };

  const hoverPoint = hoverIdx != null ? data[hoverIdx] : null;
  const hoverClassics = hoverIdx != null ? classics[hoverIdx] : 0;

  const FILTERS: { value: ChartFilter; label: string; color: string; activeColor: string }[] = [
    { value: "all", label: "All", color: "border-gray-200 text-gray-400", activeColor: "bg-gray-100 border-gray-300 text-gray-700 font-semibold" },
    { value: "ebikes", label: "Ebikes", color: "border-gray-200 text-gray-400", activeColor: "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold" },
    { value: "classics", label: "Classics", color: "border-gray-200 text-gray-400", activeColor: "bg-teal-600/10 border-teal-600/40 text-teal-600 font-semibold" },
  ];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1 justify-end mb-1">
        {FILTERS.map(({ value, label, color, activeColor }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-all ${filter === value ? activeColor : color}`}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className="w-full cursor-crosshair"
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={PAD.left} x2={W - PAD.right} y1={y(capacity)} y2={y(capacity)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,3" />
        <text x={W - PAD.right + 2} y={y(capacity) + 3} fill="#d1d5db" fontSize="8">{capacity}</text>

        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#f3f4f6" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={y(v) + 3} fill="#9ca3af" fontSize="8" textAnchor="end">{v}</text>
          </g>
        ))}

        {filter === "all" && (
          <polyline points={bikeLine} fill="none" stroke="rgb(59, 130, 246)" strokeWidth="1.5" strokeLinejoin="round" />
        )}
        {filter === "classics" && (
          <polyline points={classicLine} fill="none" stroke="rgb(14, 165, 133)" strokeWidth="1.5" strokeLinejoin="round" />
        )}
        {(filter === "all" || filter === "ebikes") && (
          <polyline points={ebikeLine} fill="none" stroke="rgb(124, 58, 237)" strokeWidth="1.5" strokeLinejoin="round" />
        )}

        {hoverIdx != null && hoverPoint && (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="3,2" />
            {(filter === "all" || filter === "ebikes") && (
              <circle cx={x(hoverIdx)} cy={y(hoverPoint.ebikes)} r="3" fill="rgb(124, 58, 237)" />
            )}
            {filter === "all" && (
              <circle cx={x(hoverIdx)} cy={y(hoverPoint.bikes)} r="3" fill="rgb(59, 130, 246)" />
            )}
            {filter === "classics" && (
              <circle cx={x(hoverIdx)} cy={y(hoverClassics)} r="3" fill="rgb(14, 165, 133)" />
            )}
          </g>
        )}

        {xLabels.map(({ i, label }) => (
          <text key={i} x={x(i)} y={H - 4} fill="#9ca3af" fontSize="8" textAnchor="middle">{label}</text>
        ))}
      </svg>

      {hoverPoint ? (
        <div className="flex gap-3 text-[10px] justify-center text-gray-500">
          <span>{formatTime(hoverPoint.ts, showDate)}</span>
          {(filter === "all" || filter === "ebikes") && <span className="text-purple-600">{hoverPoint.ebikes} ebikes</span>}
          {filter === "all" && <span className="text-blue-500">{hoverPoint.bikes} total</span>}
          {(filter === "all" || filter === "classics") && <span className="text-teal-600">{hoverClassics} classics</span>}
          <span className="text-gray-400">{hoverPoint.docks} docks</span>
        </div>
      ) : (
        <div className="flex gap-4 text-[10px] justify-center">
          {(filter === "all" || filter === "ebikes") && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-purple-600 rounded" /> Ebikes
            </span>
          )}
          {filter === "all" && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-blue-500 rounded" /> Total bikes
            </span>
          )}
          {filter === "classics" && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-teal-600 rounded" /> Classics
            </span>
          )}
          <span className="flex items-center gap-1 text-gray-400">
            <span className="inline-block w-3 h-0 border-t border-dashed border-gray-300" /> Capacity
          </span>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color, title }: { label: string; value: string | number; color: string; title?: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-gray-50 flex-1" title={title}>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-gray-400 uppercase tracking-wide text-center">{label}</span>
    </div>
  );
}

const HOUR_OPTIONS: { value: number; label: string }[] = [
  { value: 6, label: "6h" },
  { value: 12, label: "12h" },
  { value: 24, label: "24h" },
  { value: 168, label: "1w" },
];

export default function StationModal({ station, onClose }: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [lastEbike, setLastEbike] = useState<{ avg_time: string | null; occurrences: number } | null>(null);

  const stationId = station?.station_id;

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    setLoading(true);
    getStationHistory(stationId, hours)
      .then((data) => { if (!cancelled) setHistory(data); })
      .catch(() => { if (!cancelled) setHistory([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stationId, hours]);

  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    getStationLastEbike(stationId)
      .then((data) => { if (!cancelled) setLastEbike(data); })
      .catch(() => { if (!cancelled) setLastEbike(null); });
    return () => { cancelled = true; };
  }, [stationId]);

  if (!station) return null;

  const classics = Math.max(0, station.num_bikes_available - station.num_ebikes_available);
  const activeHistory = history.filter((d) => {
    const hour = new Date(d.ts).getHours();
    return hour >= 6 && hour < 24; // exclude 12am–6am sleeping hours
  });
  const avgFill = activeHistory.length && station.capacity
    ? Math.round((activeHistory.reduce((sum, d) => sum + d.bikes, 0) / activeHistory.length / station.capacity) * 100)
    : null;

  return createPortal(
    <div className="station-modal-overlay" onPointerDown={onClose}>
      <div className="station-modal-card" onPointerDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">{station.name}</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {!station.is_renting && <span className="text-red-500 font-medium">Not renting</span>}
                {!station.is_returning && <span className={`text-red-500 font-medium ${!station.is_renting ? "ml-2" : ""}`}>Not returning</span>}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none bg-transparent border-none cursor-pointer p-1"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Current stats */}
        <div className="px-5 pb-4">
          <div className="flex gap-2 flex-wrap">
            <StatPill label="Ebikes" value={station.num_ebikes_available} color="text-purple-600" />
            <StatPill label="Classic" value={classics} color="text-blue-500" />

            <StatPill label={`Avg Fill (${HOUR_OPTIONS.find(o => o.value === hours)?.label})`} value={avgFill != null ? `${avgFill}%` : "\u2014"} color={avgFill == null ? "text-gray-400" : avgFill >= 50 ? "text-green-600" : avgFill >= 10 ? "text-amber-600" : "text-red-500"} />
            <StatPill label={lastEbike?.days_total ? `Gone By (${lastEbike.days_empty}/${lastEbike.days_total}d)` : "Ebikes Gone By"} value={lastEbike?.avg_time ? lastEbike.avg_time.replace(" ", "") : "\u2014"} color="text-orange-600" title="Avg time ebikes run out and stay empty for 30+ min. Shows how many days this happened out of the last week." />
          </div>

          <div className="mt-3 h-2 rounded-full bg-gray-200 overflow-hidden flex">
            <div className="h-full bg-purple-500" style={{ width: `${station.capacity ? (station.num_ebikes_available / station.capacity) * 100 : 0}%` }} />
            <div className="h-full bg-blue-400" style={{ width: `${station.capacity ? (classics / station.capacity) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Time-series chart */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Availability Over Time</span>
            <div className="flex gap-1">
              {HOUR_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={(e) => { e.stopPropagation(); setHours(value); }}
                  className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-all ${
                    hours === value
                      ? "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold"
                      : "border-gray-200 bg-transparent text-gray-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="text-xs text-gray-400 text-center py-6">Loading...</div>
          ) : history.length < 2 ? (
            <div className="text-xs text-gray-400 text-center py-6">
              Not enough data yet for {hours}h view. Snapshots are collected every 5 min.
            </div>
          ) : (
            <MiniChart history={history} capacity={station.capacity} showDate={hours >= 168} />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 text-[10px] text-gray-400">
          Station ID: {station.station_id}
        </div>
      </div>
    </div>,
    document.body
  );
}
