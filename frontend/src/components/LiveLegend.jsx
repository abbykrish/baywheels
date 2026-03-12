import React from "react";

const STATION_COLORS = [
  { color: "rgb(34, 197, 94)", label: "50%+ ebikes" },
  { color: "rgb(234, 179, 8)", label: "20-50% ebikes" },
  { color: "rgb(220, 38, 38)", label: "< 20% ebikes" },
];

export default function LiveLegend() {
  return (
    <div className="absolute bottom-6 right-[380px] bg-white/92 backdrop-blur-md rounded-xl border border-black/8 shadow-md p-3 flex flex-col gap-2 text-xs">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Station Fill Level</div>
      <div className="flex flex-col gap-1">
        {STATION_COLORS.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-gray-600">{label}</span>
          </div>
        ))}
      </div>
      <div className="h-px bg-black/8 my-1" />
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "rgb(59, 130, 246)" }} />
        <span className="text-gray-600">Free bike</span>
      </div>
      <div className="h-px bg-black/8 my-1" />
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Recent Changes</div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: "rgb(34, 197, 94)" }} />
          <span className="text-gray-600">Gained bikes</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: "rgb(220, 38, 38)" }} />
          <span className="text-gray-600">Lost bikes</span>
        </div>
      </div>
    </div>
  );
}
