import { create } from "zustand";
import { parseISO, addMonths, format } from "date-fns";
import {
  getStats, getFlows, getStations, getHourly, getMonths,
  getLiveStations, getLiveBikes, getLiveMeta, getLiveCoverage, getLiveTrends,
  getRebalancingKpi,
} from "./api";

const LAYERS = ["live", "arcs", "heatmap", "stations"];

function getInitialLayer() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return LAYERS.includes(tab) ? tab : "live";
}

export { LAYERS };

export const useStore = create((set, get) => ({
  // --- Historical data ---
  stats: null,
  flows: [],
  stations: [],
  hourly: [],
  months: [],
  selectedMonth: "all",
  arcCount: 20,
  loading: true,
  error: null,

  // --- Live data ---
  liveStations: [],
  liveBikes: [],
  liveMeta: null,
  liveCoverage: { emptiest: [], best: [] },
  liveTrends: [],
  trendMinutes: 5,

  // --- Rebalancing KPI ---
  rebalancingKpi: null,
  rebalancingWindowHours: 24,
  rebalancingLoading: false,
  highlightedClusterCenterId: null,
  expandedClusterId: null,
  highlightedAreaKey: null,

  // --- UI ---
  activeLayer: getInitialLayer(),
  highlightedStationId: null,
  highlightedRoute: null,
  selectedStation: null,
  sidebarOpen: false,
  flyToCity: null,
  showTransit: false,
  showRebalance: false,

  // --- Simple setters ---
  setActiveLayer: (layer) => set({ activeLayer: layer }),
  setSelectedMonth: (month) => set({ selectedMonth: month }),
  setArcCount: (count) => set({ arcCount: count }),
  setHighlightedStationId: (id) => set({ highlightedStationId: id }),
  setHighlightedRoute: (route) => set({ highlightedRoute: route }),
  setSelectedStation: (station) => set({ selectedStation: station }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setFlyToCity: (city) => set({ flyToCity: city }),
  setShowTransit: (show) => set({ showTransit: show }),
  setShowRebalance: (show) => set({ showRebalance: show }),
  setHighlightedClusterCenterId: (id) => set({ highlightedClusterCenterId: id }),
  setExpandedClusterId: (id) => set({ expandedClusterId: id }),
  setHighlightedAreaKey: (key) => set({ highlightedAreaKey: key }),

  // --- Async actions ---
  loadMonths: async () => {
    try {
      const months = await getMonths();
      set({ months });
    } catch {}
  },

  loadHistoricalData: async () => {
    const { selectedMonth, arcCount } = get();
    set({ loading: true, error: null });
    let start = null;
    let end = null;
    if (selectedMonth !== "all") {
      const d = parseISO(selectedMonth);
      start = selectedMonth;
      end = format(addMonths(d, 1), "yyyy-MM-dd");
    }
    try {
      const [stats, flows, stations, hourly] = await Promise.all([
        getStats(start, end),
        getFlows(start, end, arcCount),
        getStations(start, end),
        getHourly(start, end),
      ]);
      set({ stats, flows, stations, hourly });
    } catch (e) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  loadLiveData: async () => {
    const { trendMinutes } = get();
    try {
      const [liveStations, liveBikes, liveMeta, liveCoverage, liveTrends] = await Promise.all([
        getLiveStations(),
        getLiveBikes(),
        getLiveMeta(),
        getLiveCoverage(10),
        getLiveTrends(trendMinutes),
      ]);
      set({ liveStations, liveBikes, liveMeta, liveCoverage, liveTrends });
    } catch (e) {
      console.error("Live data fetch error:", e);
    }
  },

  loadTrends: async (minutes) => {
    set({ trendMinutes: minutes });
    try {
      const liveTrends = await getLiveTrends(minutes);
      set({ liveTrends });
    } catch {}
  },

  loadRebalancingKpi: async (hours) => {
    const next = hours ?? get().rebalancingWindowHours;
    set({ rebalancingLoading: true, rebalancingWindowHours: next });
    try {
      const data = await getRebalancingKpi(next);
      set({ rebalancingKpi: data });
    } catch (e) {
      console.error("Rebalancing KPI fetch error:", e);
    } finally {
      set({ rebalancingLoading: false });
    }
  },
}));
