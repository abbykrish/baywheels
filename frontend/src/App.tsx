import React, { useEffect } from "react";
import StatsBar from "./components/StatsBar";
import MapView, { CITIES } from "./components/MapView";
import HourlyChart from "./components/HourlyChart";
import Legend from "./components/Legend";
import LiveLegend from "./components/LiveLegend";
import Sidebar from "./components/Sidebar";
import MonthFilter from "./components/MonthFilter";
import StationModal from "./components/StationModal";
import WelcomeModal from "./components/WelcomeModal";
import { useStore, LAYERS } from "./store";

export default function App() {
  const activeLayer = useStore((s) => s.activeLayer);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const selectedMonth = useStore((s) => s.selectedMonth);
  const setSelectedMonth = useStore((s) => s.setSelectedMonth);
  const arcCount = useStore((s) => s.arcCount);
  const setArcCount = useStore((s) => s.setArcCount);
  const months = useStore((s) => s.months);
  const hourly = useStore((s) => s.hourly);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const flyToCity = useStore((s) => s.flyToCity);
  const setFlyToCity = useStore((s) => s.setFlyToCity);
  const showTransit = useStore((s) => s.showTransit);
  const setShowTransit = useStore((s) => s.setShowTransit);
  const loadMonths = useStore((s) => s.loadMonths);
  const loadHistoricalData = useStore((s) => s.loadHistoricalData);
  const loadLiveData = useStore((s) => s.loadLiveData);

  // Sync active layer to URL
  useEffect(() => {
    const url = new URL(window.location);
    if (activeLayer === "live") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", activeLayer);
    }
    window.history.replaceState({}, "", url);
  }, [activeLayer]);

  // Load months on mount
  useEffect(() => { loadMonths(); }, []);

  // Load historical data when filters change
  useEffect(() => { loadHistoricalData(); }, [selectedMonth, arcCount]);

  // Live data auto-refresh
  useEffect(() => {
    if (activeLayer !== "live") return;
    loadLiveData();
    const interval = setInterval(loadLiveData, 60_000);
    return () => clearInterval(interval);
  }, [activeLayer]);

  return (
    <div className="w-full h-full relative">
      <StatsBar />
      <MapView />

      {/* Controls panel */}
      <div className="fixed md:absolute bottom-0 left-0 right-0 md:bottom-6 md:left-6 md:right-auto bg-white/92 backdrop-blur-md md:rounded-xl border-t md:border border-black/8 shadow-md p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:p-4 md:w-[320px] flex flex-col gap-2 md:gap-3 z-10">
        {/* Layer tabs */}
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

        {/* Transit overlay toggle */}
        <button
          onClick={() => setShowTransit(!showTransit)}
          className={`flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded-md border cursor-pointer transition-all
            ${showTransit
              ? "bg-purple-600/10 border-purple-600/40 text-purple-600 font-semibold"
              : "border-black/10 bg-transparent text-gray-500"
            }`}
        >
          <span>Transit stations</span>
          <span className="flex gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "rgb(0, 91, 157)" }} title="BART" />
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "rgb(220, 38, 38)" }} title="Caltrain" />
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "rgb(22, 163, 74)" }} title="Muni" />
          </span>
        </button>

        {/* City picker — desktop only */}
        <div className="hidden md:flex gap-1">
          {Object.entries(CITIES).map(([key, city]) => (
            <button
              key={key}
              onClick={() => setFlyToCity(flyToCity === key ? key + "_" : key)}
              className="flex-1 py-1.5 text-[11px] rounded-md border border-black/10 bg-transparent text-gray-500 cursor-pointer hover:border-purple-600/40 hover:text-purple-600 transition-all"
            >
              {city.label}
            </button>
          ))}
        </div>

        {/* Desktop-only: month filter, arc count, hourly chart */}
        <div className="hidden md:flex md:flex-col md:gap-3">
          {activeLayer !== "live" && (
            <MonthFilter months={months} selected={selectedMonth} onChange={setSelectedMonth} />
          )}

          {activeLayer === "arcs" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-wide text-gray-400">Top Routes</label>
              <div className="flex gap-1">
                {[10, 20, 50].map((n) => (
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

      {/* Sidebar toggle (mobile) */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden absolute top-[90px] right-3 z-20 bg-white/92 backdrop-blur-md border border-black/8 shadow-md rounded-lg px-3 py-2 text-xs font-semibold text-purple-600 cursor-pointer"
      >
        {sidebarOpen ? "\u2715" : "Details"}
      </button>

      {sidebarOpen && <div className="md:hidden fixed inset-0 bg-black/20 z-14" onClick={() => setSidebarOpen(false)} />}
      <Sidebar />
      {activeLayer === "live" ? <LiveLegend /> : <Legend activeLayer={activeLayer} />}
      <StationModal />
      <WelcomeModal />

      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-red-600 text-red-600 px-6 py-4 rounded-lg flex gap-3 items-center shadow-lg">
          {error}
          <button onClick={loadHistoricalData} className="px-3 py-1 bg-purple-600 text-white border-none rounded cursor-pointer">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
