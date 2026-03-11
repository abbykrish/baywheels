import React, { useState, useEffect, useCallback } from "react";
import { parseISO, addMonths, format } from "date-fns";
import StatsBar from "./components/StatsBar.jsx";
import MapView from "./components/MapView.jsx";
import HourlyChart from "./components/HourlyChart.jsx";
import Legend from "./components/Legend.jsx";
import Sidebar from "./components/Sidebar.jsx";
import MonthFilter from "./components/MonthFilter.jsx";
import { getStats, getFlows, getStations, getHourly, getMonths } from "./api.js";

const LAYERS = ["arcs", "heatmap", "stations"];

export default function App() {
  const [stats, setStats] = useState(null);
  const [flows, setFlows] = useState([]);
  const [stations, setStations] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [months, setMonths] = useState([]);
  const [activeLayer, setActiveLayer] = useState("arcs");
  const [arcCount, setArcCount] = useState(150);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // "all" means no filter; otherwise "YYYY-MM-DD" of the month start
  const [selectedMonth, setSelectedMonth] = useState("all");

  // Load available months on mount
  useEffect(() => {
    getMonths().then(setMonths).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    let start = null;
    let end = null;
    if (selectedMonth !== "all") {
      const d = parseISO(selectedMonth);
      start = selectedMonth;
      end = format(addMonths(d, 1), "yyyy-MM-dd");
    }
    try {
      const [s, f, st, h] = await Promise.all([
        getStats(start, end),
        getFlows(start, end, arcCount),
        getStations(start, end),
        getHourly(start, end),
      ]);
      setStats(s);
      setFlows(f);
      setStations(st);
      setHourly(h);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [arcCount, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="w-full h-full relative">
      <StatsBar stats={stats} loading={loading} />
      <MapView flows={flows} stations={stations} activeLayer={activeLayer} />

      {/* Controls panel */}
      <div className="absolute bottom-6 left-6 bg-white/92 backdrop-blur-md rounded-xl border border-black/8 shadow-md p-4 w-[280px] flex flex-col gap-3">
        <MonthFilter
          months={months}
          selected={selectedMonth}
          onChange={setSelectedMonth}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-wide text-gray-400">Layer</label>
          <div className="flex gap-1">
            {LAYERS.map((l) => (
              <button
                key={l}
                onClick={() => setActiveLayer(l)}
                className={`flex-1 py-1.5 text-xs rounded-md border cursor-pointer transition-all
                  ${activeLayer === l
                    ? "bg-blue-700/10 border-blue-700/40 text-blue-700 font-semibold"
                    : "border-black/10 bg-transparent text-gray-500"
                  }`}
              >
                {l === "arcs" ? "Trip Flows" : l === "heatmap" ? "Heat Map" : "Stations"}
              </button>
            ))}
          </div>
        </div>

        {activeLayer === "arcs" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-wide text-gray-400">
              Top routes: {arcCount}
            </label>
            <input
              type="range"
              min={20}
              max={500}
              step={10}
              value={arcCount}
              onChange={(e) => setArcCount(Number(e.target.value))}
              className="w-full accent-blue-700"
            />
          </div>
        )}

        <HourlyChart data={hourly} />
      </div>

      <Sidebar flows={flows} stations={stations} />
      <Legend activeLayer={activeLayer} />

      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-red-600 text-red-600 px-6 py-4 rounded-lg flex gap-3 items-center shadow-lg">
          {error}
          <button onClick={loadData} className="px-3 py-1 bg-blue-700 text-white border-none rounded cursor-pointer">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
