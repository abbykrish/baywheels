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
import WelcomeModal from "./components/WelcomeModal";
import { getStats, getFlows, getStations, getHourly, getMonths, getLiveStations, getLiveBikes, getLiveMeta, getLiveCoverage, getLiveTrends, getLiveBusiestHour } from "./api";

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
  const [arcCount, setArcCount] = useState(200);
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
  const [busiestHour, setBusiestHour] = useState(null);
  const [highlightedStationId, setHighlightedStationId] = useState(null);
  const [highlightedRoute, setHighlightedRoute] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      const [s, b, m, cov, trends, busiest] = await Promise.all([
        getLiveStations(),
        getLiveBikes(),
        getLiveMeta(),
        getLiveCoverage(10),
        getLiveTrends(),
        getLiveBusiestHour(),
      ]);
      setLiveStations(s);
      setLiveBikes(b);
      setLiveMeta(m);
      setLiveCoverage(cov);
      setLiveTrends(trends);
      setBusiestHour(busiest);
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
      <MapView flows={flows} stations={stations} activeLayer={activeLayer} liveStations={liveStations} liveBikes={liveBikes} liveTrends={liveTrends} highlightedStationId={highlightedStationId} highlightedRoute={highlightedRoute} onClickStation={setSelectedStation} />

      {/* Controls panel — desktop: full card, mobile: compact bottom bar */}
      <div className="fixed md:absolute bottom-0 left-0 right-0 md:bottom-6 md:left-6 md:right-auto bg-white/92 backdrop-blur-md md:rounded-xl border-t md:border border-black/8 shadow-md p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:p-4 md:w-[320px] flex flex-col gap-2 md:gap-3 z-10">
        {/* Layer tabs — always visible */}
        <div className="flex gap-1">
          {LAYERS.map((l) => (
            <button
              key={l}
              onClick={() => setActiveLayer(l)}
              className={`flex-1 px-2 py-2 md:py-1.5 text-xs rounded-md border cursor-pointer transition-all
                ${activeLayer === l
                  ? "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold"
                  : "border-black/10 bg-transparent text-gray-500"
                }`}
            >
              {l === "live" ? "Live" : l === "arcs" ? "Historical" : l === "heatmap" ? "Heat" : "Stations"}
            </button>
          ))}
        </div>

        {/* Desktop-only: month filter, arc count, hourly chart */}
        <div className="hidden md:flex md:flex-col md:gap-3">
          {activeLayer !== "live" && (
            <MonthFilter
              months={months}
              selected={selectedMonth}
              onChange={setSelectedMonth}
            />
          )}

          {activeLayer === "arcs" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-wide text-gray-400">Top Routes</label>
              <div className="flex gap-1">
                {[50, 100, 200, 500].map((n) => (
                  <button
                    key={n}
                    onClick={() => setArcCount(n)}
                    className={`flex-1 py-1.5 text-xs rounded-md border cursor-pointer transition-all ${
                      arcCount === n
                        ? "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold"
                        : "border-black/10 bg-transparent text-gray-500"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeLayer !== "live" && <HourlyChart data={hourly} />}
        </div>
      </div>

      {/* Sidebar toggle button (mobile) */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden absolute top-[90px] right-3 z-20 bg-white/92 backdrop-blur-md border border-black/8 shadow-md rounded-lg px-3 py-2 text-xs font-semibold text-purple-600 cursor-pointer"
      >
        {sidebarOpen ? "\u2715" : "Details"}
      </button>

      {/* Mobile backdrop — tap to close sidebar */}
      {sidebarOpen && <div className="md:hidden fixed inset-0 bg-black/20 z-14" onClick={() => setSidebarOpen(false)} />}
      <Sidebar flows={flows} stations={stations} activeLayer={activeLayer} liveCoverage={liveCoverage} liveTrends={liveTrends} liveStations={liveStations} busiestHour={busiestHour} onHoverStation={setHighlightedStationId} onHoverRoute={setHighlightedRoute} onClickStation={setSelectedStation} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} hourly={hourly} months={months} selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} arcCount={arcCount} onArcCountChange={setArcCount} />
      {activeLayer === "live" ? <LiveLegend /> : <Legend activeLayer={activeLayer} />}
      <StationModal station={selectedStation} onClose={() => setSelectedStation(null)} />
      <WelcomeModal />

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
