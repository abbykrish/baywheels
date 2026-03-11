import React from "react";

export default function HourlyChart({ data }) {
  if (!data || !data.length) return null;

  const max = Math.max(...data.map((d) => d.trips));

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Trips by Hour</div>
      <div className="flex items-end h-12 gap-px">
        {data.map((d) => {
          const h = d.trips / max;
          const memberRatio = d.trips > 0 ? d.member / d.trips : 0;
          return (
            <div key={d.hour} className="flex-1 h-full flex items-end" title={`${d.hour}:00 \u2014 ${d.trips.toLocaleString()} trips`}>
              <div
                className="w-full rounded-t-sm min-h-px"
                style={{
                  height: `${h * 100}%`,
                  background: `linear-gradient(to top, #1d4ed8 ${memberRatio * 100}%, #7c3aed ${memberRatio * 100}%)`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-gray-400">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
      </div>
    </div>
  );
}
