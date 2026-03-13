import React, { useState, useEffect } from "react";
import { getStationHistory } from "../api";

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

function formatTime(ts: string) {
  try {
    const d = new Date(ts.replace(" ", "T") + "Z");
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function MiniChart({ history, capacity }: { history: HistoryPoint[]; capacity: number }) {
  if (!history.length) {
    return <div className="text-xs text-gray-400 text-center py-4">No snapshot history yet.</div>;
  }

  const maxY = Math.max(capacity, ...history.map((d) => d.bikes), 1);
  const W = 360;
  const H = 130;
  const PAD = { top: 8, right: 12, bottom: 20, left: 28 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (history.length - 1)) * cw;
  const y = (v: number) => PAD.top + ch - (v / maxY) * ch;

  const ebikeLine = history.map((d, i) => `${x(i)},${y(d.ebikes)}`).join(" ");
  const bikeLine = history.map((d, i) => `${x(i)},${y(d.bikes)}`).join(" ");

  // Y-axis ticks
  const yTicks: number[] = [];
  const step = maxY <= 10 ? 2 : maxY <= 30 ? 5 : 10;
  for (let v = 0; v <= maxY; v += step) yTicks.push(v);

  // X-axis time labels (4-5 evenly spaced)
  const labelCount = 4;
  const xLabels: { i: number; label: string }[] = [];
  for (let n = 0; n < labelCount; n++) {
    const i = Math.round((n / (labelCount - 1)) * (history.length - 1));
    xLabels.push({ i, label: formatTime(history[i].ts) });
  }

  return (
    <div className="flex flex-col gap-1">
      <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`}>
        {/* Capacity line */}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(capacity)} y2={y(capacity)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,3" />
        <text x={W - PAD.right + 2} y={y(capacity) + 3} fill="#d1d5db" fontSize="8">{capacity}</text>

        {/* Grid lines */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#f3f4f6" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={y(v) + 3} fill="#9ca3af" fontSize="8" textAnchor="end">{v}</text>
          </g>
        ))}

        {/* Total bikes line */}
        <polyline points={bikeLine} fill="none" stroke="rgb(59, 130, 246)" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Ebikes line */}
        <polyline points={ebikeLine} fill="none" stroke="rgb(124, 58, 237)" strokeWidth="1.5" strokeLinejoin="round" />

        {/* X-axis labels */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={x(i)} y={H - 4} fill="#9ca3af" fontSize="8" textAnchor="middle">{label}</text>
        ))}
      </svg>
      <div className="flex gap-4 text-[10px] justify-center">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-purple-600 rounded" /> Ebikes
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-blue-500 rounded" /> Total bikes
        </span>
        <span className="flex items-center gap-1 text-gray-400">
          <span className="inline-block w-3 h-0 border-t border-dashed border-gray-300" /> Capacity
        </span>
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-gray-50 flex-1">
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</span>
    </div>
  );
}

const HOUR_OPTIONS = [6, 12, 24];

export default function StationModal({ station, onClose }: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);

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

  if (!station) return null;

  const classics = Math.max(0, station.num_bikes_available - station.num_ebikes_available);
  const fillPct = station.capacity ? Math.round((station.num_bikes_available / station.capacity) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[420px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">{station.name}</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {station.capacity} dock capacity
                {!station.is_renting && <span className="ml-2 text-red-500 font-medium">Not renting</span>}
                {!station.is_returning && <span className="ml-2 text-red-500 font-medium">Not returning</span>}
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
          <div className="flex gap-2">
            <StatPill label="Ebikes" value={station.num_ebikes_available} color="text-purple-600" />
            <StatPill label="Classic" value={classics} color="text-blue-500" />
            <StatPill label="Docks" value={station.num_docks_available} color="text-gray-500" />
            <StatPill label="Fill" value={`${fillPct}%`} color={fillPct >= 50 ? "text-green-600" : fillPct >= 10 ? "text-amber-600" : "text-red-500"} />
          </div>

          {/* Fill bar */}
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
              {HOUR_OPTIONS.map((h) => (
                <button
                  key={h}
                  onClick={() => setHours(h)}
                  className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-all ${
                    hours === h
                      ? "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold"
                      : "border-gray-200 bg-transparent text-gray-400"
                  }`}
                >
                  {h}h
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
            <MiniChart history={history} capacity={station.capacity} />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 text-[10px] text-gray-400">
          Station ID: {station.station_id}
        </div>
      </div>
    </div>
  );
}
