import React, { useState, useEffect, useCallback } from "react";
import { parseISO, addMonths, format } from "date-fns";
import StatsBar from "./components/StatsBar";
import MapView from "./components/MapView";
import HourlyChart from "./components/HourlyChart";
import Legend from "./components/Legend";
import LiveLegend from "./components/LiveLegend";
import Sidebar from "./components/Sidebar";
import MonthFilter from "./components/MonthFilter";
import StationModal from "./components/StationModal";
import { getStats, getFlows, getStations, getHourly, getMonths, getLiveStations, getLiveBikes, getLiveMeta, getLiveCoverage, getLiveTrends } from "./api";

const LAYERS = ["live", "arcs", "heatmap", "stations"];

export default function App() {
  const [stats, setStats] = useState(null);
  const [flows, setFlows] = useState([]);
  const [stations, setStations] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [months, setMonths] = useState([]);
  const [activeLayer, setActiveLayer] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    return LAYERS.includes(tab) ? tab : "live";
  });
  const [arcCount, setArcCount] = useState(150);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // "all" means no filter; otherwise "YYYY-MM-DD" of the month start
  const [selectedMonth, setSelectedMonth] = useState("all");

  // Live layer state
  const [liveStations, setLiveStations] = useState([]);
  const [liveBikes, setLiveBikes] = useState([]);
  const [liveMeta, setLiveMeta] = useState(null);
  const [liveCoverage, setLiveCoverage] = useState({ emptiest: [], best: [] });
  const [liveTrends, setLiveTrends] = useState([]);
  const [highlightedStationId, setHighlightedStationId] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);

  // Sync active layer to URL query param
  useEffect(() => {
    const url = new URL(window.location);
    if (activeLayer === "live") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", activeLayer);
    }
    window.history.replaceState({}, "", url);
  }, [activeLayer]);

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

  // Live data fetching + auto-refresh
  const loadLiveData = useCallback(async () => {
    try {
      const [s, b, m, cov, trends] = await Promise.all([
        getLiveStations(),
        getLiveBikes(),
        getLiveMeta(),
        getLiveCoverage(10),
        getLiveTrends(),
      ]);
      setLiveStations(s);
      setLiveBikes(b);
      setLiveMeta(m);
      setLiveCoverage(cov);
      setLiveTrends(trends);
    } catch (e) {
      console.error("Live data fetch error:", e);
    }
  }, []);

  useEffect(() => {
    if (activeLayer !== "live") return;
    loadLiveData();
    const interval = setInterval(loadLiveData, 60_000);
    return () => clearInterval(interval);
  }, [activeLayer, loadLiveData]);

  return (
    <div className="w-full h-full relative">
      <StatsBar stats={stats} loading={loading} activeLayer={activeLayer} liveMeta={liveMeta} />
      <MapView flows={flows} stations={stations} activeLayer={activeLayer} liveStations={liveStations} liveBikes={liveBikes} liveTrends={liveTrends} highlightedStationId={highlightedStationId} onClickStation={setSelectedStation} />

      {/* Controls panel */}
      <div className="absolute bottom-6 left-6 bg-white/92 backdrop-blur-md rounded-xl border border-black/8 shadow-md p-4 w-[320px] flex flex-col gap-3">
        {activeLayer !== "live" && (
          <MonthFilter
            months={months}
            selected={selectedMonth}
            onChange={setSelectedMonth}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-wide text-gray-400">Layer</label>
          <div className="flex gap-1">
            {LAYERS.map((l) => (
              <button
                key={l}
                onClick={() => setActiveLayer(l)}
                className={`flex-1 py-1.5 text-xs rounded-md border cursor-pointer transition-all
                  ${activeLayer === l
                    ? "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold"
                    : "border-black/10 bg-transparent text-gray-500"
                  }`}
              >
                {l === "live" ? "Live" : l === "arcs" ? "Historical" : l === "heatmap" ? "Heat Map" : "Stations"}
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
              className="w-full accent-purple-600"
            />
          </div>
        )}

        {activeLayer !== "live" && <HourlyChart data={hourly} />}
      </div>

      <Sidebar flows={flows} stations={stations} activeLayer={activeLayer} liveCoverage={liveCoverage} liveTrends={liveTrends} liveStations={liveStations} onHoverStation={setHighlightedStationId} onClickStation={setSelectedStation} />
      {activeLayer === "live" ? <LiveLegend /> : <Legend activeLayer={activeLayer} />}
      <StationModal station={selectedStation} onClose={() => setSelectedStation(null)} />

      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-red-600 text-red-600 px-6 py-4 rounded-lg flex gap-3 items-center shadow-lg">
          {error}
          <button onClick={loadData} className="px-3 py-1 bg-purple-600 text-white border-none rounded cursor-pointer">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
