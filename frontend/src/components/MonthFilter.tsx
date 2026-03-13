import React from "react";
import { parseISO, format } from "date-fns";

function formatMonth(dateStr) {
  return format(parseISO(dateStr), "MMM yyyy");
}

function formatTrips(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function MonthFilter({ months, selected, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] uppercase tracking-wide text-gray-400">
        Time Period
      </label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md bg-white text-gray-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 cursor-pointer"
      >
        <option value="all">All Time</option>
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {formatMonth(m.month)} ({formatTrips(m.trips)} trips)
          </option>
        ))}
      </select>
    </div>
  );
}
