import React from "react";

export default function HourlyChart({ data }) {
  if (!data || !data.length) return null;

  const maxWeekday = Math.max(...data.map((d) => d.weekday ?? d.trips));
  const maxWeekend = Math.max(...data.map((d) => d.weekend ?? 0));
  const max = Math.max(maxWeekday, maxWeekend, 1);

  const hasWeekendData = data.some((d) => d.weekend > 0);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Trips by Hour</div>
        {hasWeekendData && (
          <div className="flex items-center gap-2.5 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-purple-600" />Weekday</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-teal-400" />Weekend</span>
          </div>
        )}
      </div>
      <div className="flex items-end h-12 gap-px">
        {data.map((d) => {
          const weekday = d.weekday ?? d.trips;
          const weekend = d.weekend ?? 0;
          const hWeekday = weekday / max;
          const hWeekend = weekend / max;
          return (
            <div key={d.hour} className="flex-1 h-full flex items-end relative" title={`${d.hour}:00 — ${weekday.toLocaleString()} weekday, ${weekend.toLocaleString()} weekend`}>
              <div
                className="absolute bottom-0 left-0 right-0 rounded-t-sm"
                style={{
                  height: `${hWeekday * 100}%`,
                  background: "#7c3aed",
                  minHeight: weekday > 0 ? "1px" : 0,
                }}
              />
              {hasWeekendData && (
                <div
                  className="absolute bottom-0 left-0 right-0 rounded-t-sm"
                  style={{
                    height: `${hWeekend * 100}%`,
                    background: "rgba(45, 212, 191, 0.6)",
                    minHeight: weekend > 0 ? "1px" : 0,
                  }}
                />
              )}
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
