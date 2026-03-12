import React from "react";

function fmt(n) {
  if (n == null) return "\u2014";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatHour(h) {
  if (h == null) return "\u2014";
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr} ${ampm}`;
}

const STATS_CONFIG = [
  { key: "total_trips", label: "Total Trips", format: fmt },
  { key: "active_stations", label: "Stations", format: fmt },
  { key: "avg_duration_min", label: "Avg Duration", format: (v) => v ? `${v} min` : "\u2014" },
  { key: "member_trips", label: "Member Trips", format: fmt },
  { key: "casual_trips", label: "Casual Trips", format: fmt },
  { key: "stationless_trips", label: "Stationless", format: fmt },
  { key: "busiest_station", label: "Busiest Station", format: (v) => v || "\u2014" },
  { key: "peak_hour", label: "Peak Hour", format: formatHour },
];

const LIVE_STATS_CONFIG = [
  { key: "total_ebikes", label: "Ebikes Available", format: fmt },
  { key: "station_count", label: "Stations", format: fmt },
  { key: "stations_at_zero_ebikes", label: "At Zero Ebikes", format: fmt },
  { key: "free_bike_count", label: "Free Bikes", format: fmt },
  { key: "last_poll", label: "Last Poll", format: (v) => v ? new Date(v).toLocaleTimeString() : "\u2014" },
];

export default function StatsBar({ stats, loading, activeLayer, liveMeta }) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 bg-white/92 backdrop-blur-md border-b border-black/8 px-6 py-3 flex items-center gap-8">
      <div className="whitespace-nowrap">
        <div className="text-lg font-bold text-gray-900 tracking-tight">Bay Wheels Trip Visualizer</div>
        <div className="text-[10px] text-gray-400">fun insights from data published by <a href="https://www.lyft.com/bikes/bay-wheels/system-data" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">Lyft</a></div>
      </div>
      <div className="flex gap-6 flex-1 overflow-auto">
        {(activeLayer === "live" ? LIVE_STATS_CONFIG : STATS_CONFIG).map(({ key, label, format }) => (
          <div key={key} className="flex flex-col min-w-[80px]">
            <div className="text-base font-semibold text-purple-600">
              {activeLayer === "live"
                ? format(liveMeta?.[key])
                : loading ? "..." : format(stats?.[key])}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
