import React from "react";

const STATION_COLORS = [
  { color: "rgb(34, 197, 94)", label: "50%+" },
  { color: "rgb(249, 115, 22)", label: "25-50%" },
  { color: "rgb(234, 179, 8)", label: "10-25%" },
  { color: "rgb(220, 38, 38)", label: "<10%" },
];

export default function LiveLegend() {
  return (
    <>
      {/* Desktop: full legend */}
      <div className="hidden md:flex absolute bottom-6 md:right-[380px] bg-white/92 backdrop-blur-md rounded-xl border border-black/8 shadow-md p-3 flex-col gap-2 text-xs">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Station Fill Level</div>
        <div className="flex flex-col gap-1">
          {STATION_COLORS.map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-600">{label} ebikes</span>
            </div>
          ))}
        </div>
        <div className="h-px bg-black/8 my-1" />
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "rgb(59, 130, 246)" }} />
          <span className="text-gray-600">Loose bike</span>
        </div>
        <div className="h-px bg-black/8 my-1" />
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Recent Activity</div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 rounded" style={{ background: "radial-gradient(circle, rgba(34,197,94,0.5), rgba(34,197,94,0))" }} />
            <span className="text-gray-600">Gaining bikes</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 rounded" style={{ background: "radial-gradient(circle, rgba(220,38,38,0.5), rgba(220,38,38,0))" }} />
            <span className="text-gray-600">Losing bikes</span>
          </div>
        </div>
      </div>

      {/* Mobile: compact horizontal strip */}
      <div className="md:hidden fixed bottom-[80px] left-3 right-3 bg-white/92 backdrop-blur-md rounded-lg border border-black/8 shadow-sm px-3 py-2 flex items-center gap-3 z-10 text-[10px]">
        {STATION_COLORS.map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-gray-500">{label}</span>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "rgb(59, 130, 246)" }} />
          <span className="text-gray-500">Loose</span>
        </span>
      </div>
    </>
  );
}
