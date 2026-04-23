import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useStore } from "../store";
import { Map as MapGL } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { FlyToInterpolator } from "@deck.gl/core";
import transitStations from "../data/transit-stations.json";

// Group agencies into color buckets. The MTC dataset tags a few agencies
// under two primary names (BART has both "Bay Area Rapid Transit" and the
// longer "San Francisco Bay Area Rapid Transit District"; same for Caltrain
// and Muni).
const TRANSIT_SYSTEMS: Record<string, { label: string; color: [number, number, number, number] }> = {
  "San Francisco Bay Area Rapid Transit District": { label: "BART", color: [0, 91, 157, 230] },
  "Bay Area Rapid Transit":                         { label: "BART", color: [0, 91, 157, 230] },
  "City and County of San Francisco":               { label: "Muni", color: [22, 163, 74, 230] },
  "San Francisco Municipal Transportation Agency":  { label: "Muni", color: [22, 163, 74, 230] },
  "Peninsula Corridor Joint Powers Board":          { label: "Caltrain", color: [220, 38, 38, 230] },
  "Caltrain":                                       { label: "Caltrain", color: [220, 38, 38, 230] },
};
const TRANSIT_DEFAULT_COLOR: [number, number, number, number] = [120, 120, 120, 180];

function transitColor(agency: string): [number, number, number, number] {
  return TRANSIT_SYSTEMS[agency]?.color ?? TRANSIT_DEFAULT_COLOR;
}

function transitLabel(agency: string): string {
  return TRANSIT_SYSTEMS[agency]?.label ?? agency;
}

const CITIES = {
  sf: { label: "SF", longitude: -122.42, latitude: 37.775, zoom: 13 },
  eastbay: { label: "East Bay", longitude: -122.27, latitude: 37.805, zoom: 13 },
  sanjose: { label: "San Jose", longitude: -121.89, latitude: 37.335, zoom: 13 },
};

const INITIAL_VIEW = {
  longitude: -122.42,
  latitude: 37.775,
  zoom: 12,
  pitch: 0,
  bearing: 0,
};

const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const TOOLTIP_STYLE = {
  background: "#fff",
  color: "#1d1d1f",
  fontSize: "12px",
  padding: "8px 12px",
  borderRadius: "6px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
};

function densityColor(t) {
  if (t < 0.25) {
    const s = t / 0.25;
    return [66 + s * (0 - 66), 133 + s * (180 - 133), 244 + s * (216 - 244), 140 + t * 100];
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [0 + s * 56, 180 + s * (142 - 180), 216 + s * (60 - 216), 160 + t * 80];
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [56 + s * (235 - 56), 142 + s * (140 - 142), 60 + s * (45 - 60), 180 + t * 60];
  }
  const s = (t - 0.75) / 0.25;
  return [235 + s * (220 - 235), 140 + s * (38 - 140), 45 + s * (38 - 45), 200 + t * 40];
}

function ebikeFillColor(station) {
  if (!station.capacity || station.capacity === 0) return [150, 150, 150, 180];
  const ratio = station.num_ebikes_available / station.capacity;
  if (ratio >= 0.5) return [34, 197, 94, 200];    // green
  if (ratio >= 0.25) return [249, 115, 22, 200];   // orange
  if (ratio >= 0.1) return [234, 179, 8, 200];    // yellow
  return [220, 38, 38, 200];                       // red
}

export { CITIES };

export default function MapView() {
  const flows = useStore((s) => s.flows);
  const stations = useStore((s) => s.stations);
  const activeLayer = useStore((s) => s.activeLayer);
  const liveStations = useStore((s) => s.liveStations);
  const liveBikes = useStore((s) => s.liveBikes);
  const liveTrends = useStore((s) => s.liveTrends);
  const highlightedStationId = useStore((s) => s.highlightedStationId);
  const highlightedRoute = useStore((s) => s.highlightedRoute);
  const setSelectedStation = useStore((s) => s.setSelectedStation);
  const flyToCity = useStore((s) => s.flyToCity);
  const showTransit = useStore((s) => s.showTransit);
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  useEffect(() => {
    if (!flyToCity) return;
    const key = flyToCity.replace(/_$/, "");
    const c = CITIES[key];
    if (!c) return;
    setViewState((prev) => ({
      ...prev,
      longitude: c.longitude,
      latitude: c.latitude,
      zoom: c.zoom,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [flyToCity]);

  // Adjust pitch based on layer: angled for arcs, top-down for live
  useEffect(() => {
    const targetPitch = activeLayer === "arcs" ? 45 : 0;
    setViewState((prev) => {
      if (prev.pitch === targetPitch) return prev;
      return { ...prev, pitch: targetPitch, transitionDuration: 500, transitionInterpolator: new FlyToInterpolator() };
    });
  }, [activeLayer]);

  const maxCount = useMemo(() => {
    if (!flows.length) return 1;
    return Math.max(...flows.map((f) => f.count));
  }, [flows]);

  const layers = useMemo(() => {
    const result = [];

    if (activeLayer === "arcs") {
      const isHighlighted = (d) =>
        highlightedRoute && d.from_name === highlightedRoute.from_name && d.to_name === highlightedRoute.to_name;
      const HIGHLIGHT_COLOR = [59, 130, 246, 255]; // blue-500
      result.push(
        new ArcLayer({
          id: "trip-arcs",
          data: flows,
          getSourcePosition: (d) => d.from,
          getTargetPosition: (d) => d.to,
          getSourceColor: (d) => isHighlighted(d) ? HIGHLIGHT_COLOR : densityColor(Math.sqrt(d.count / maxCount)),
          getTargetColor: (d) => isHighlighted(d) ? HIGHLIGHT_COLOR : densityColor(Math.sqrt(d.count / maxCount)),
          getWidth: (d) => isHighlighted(d) ? 5 : 1.5 + (d.count / maxCount) * 4,
          greatCircle: false,
          pickable: true,
          updateTriggers: {
            getSourceColor: highlightedRoute,
            getTargetColor: highlightedRoute,
            getWidth: highlightedRoute,
          },
        })
      );
      result.push(
        new ScatterplotLayer({
          id: "arc-stations",
          data: stations,
          getPosition: (d) => d.position,
          getRadius: (d) => 20 + Math.sqrt(d.departures) * 0.3,
          getFillColor: [100, 100, 100, 50],
          radiusMinPixels: 2,
          radiusMaxPixels: 10,
        })
      );
    }

    if (activeLayer === "heatmap") {
      result.push(
        new HeatmapLayer({
          id: "trip-heat",
          data: stations,
          getPosition: (d) => d.position,
          getWeight: (d) => d.departures,
          radiusPixels: 40,
          intensity: 1.5,
          threshold: 0.05,
          colorRange: [
            [66, 133, 244], [0, 180, 216], [56, 142, 60],
            [235, 200, 45], [235, 140, 45], [220, 38, 38],
          ],
        })
      );
    }

    if (activeLayer === "stations") {
      const total = (s) => s.departures + s.arrivals;
      const maxTotal = Math.max(...stations.map(total), 1);
      result.push(
        new ScatterplotLayer({
          id: "station-circles",
          data: stations,
          getPosition: (d) => d.position,
          getRadius: (d) => 30 + Math.sqrt(total(d) / maxTotal) * 200,
          getFillColor: (d) => densityColor(total(d) / maxTotal),
          radiusMinPixels: 3,
          radiusMaxPixels: 25,
          pickable: true,
          stroked: true,
          getLineColor: [0, 0, 0, 30],
          lineWidthMinPixels: 1,
        })
      );
    }

    if (activeLayer === "live") {
      // Merge trend deltas into station data for tooltips
      const trendMap = new Map();
      for (const t of liveTrends) trendMap.set(t.station_id, t);
      const stationsWithTrends = liveStations.map((s) => {
        const t = trendMap.get(s.station_id);
        return t ? { ...s, bike_delta: t.bike_delta, ebike_delta: t.ebike_delta } : s;
      });

      result.push(
        new ScatterplotLayer({
          id: "live-stations",
          data: stationsWithTrends,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: (d) => 25 + Math.sqrt(d.capacity || 1) * 8,
          getFillColor: (d) => ebikeFillColor(d),
          radiusMinPixels: 4,
          radiusMaxPixels: 20,
          pickable: true,
          stroked: true,
          getLineColor: [0, 0, 0, 40],
          lineWidthMinPixels: 1,
        })
      );
      result.push(
        new ScatterplotLayer({
          id: "live-bikes",
          data: liveBikes,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 15,
          getFillColor: [59, 130, 246, 180],
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          pickable: true,
        })
      );

    }

    if (showTransit) {
      result.push(
        new ScatterplotLayer({
          id: "transit-stations",
          data: transitStations,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 8,
          getFillColor: (d) => transitColor(d.agency),
          radiusMinPixels: 3,
          radiusMaxPixels: 7,
          stroked: true,
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 1,
          pickable: true,
        })
      );
    }

    // Unified highlight ring for any hovered station
    if (highlightedStationId) {
      let highlightData = [];
      // Check live stations (keyed by station_id)
      const liveMatch = liveStations.find((s) => s.station_id === highlightedStationId);
      if (liveMatch) {
        highlightData = [{ position: [liveMatch.lon, liveMatch.lat] }];
      }
      // Check historical stations (keyed by id)
      const histMatch = stations.find((s) => s.id === highlightedStationId);
      if (histMatch) {
        highlightData = [{ position: histMatch.position }];
      }
      if (highlightData.length) {
        result.push(
          new ScatterplotLayer({
            id: "station-highlight",
            data: highlightData,
            getPosition: (d) => d.position,
            getRadius: 200,
            getFillColor: [255, 255, 255, 0],
            radiusMinPixels: 18,
            radiusMaxPixels: 40,
            stroked: true,
            getLineColor: [59, 130, 246, 255],
            lineWidthMinPixels: 3,
          })
        );
      }
    }

    return result;
  }, [flows, stations, activeLayer, maxCount, liveStations, liveBikes, liveTrends, highlightedStationId, highlightedRoute, showTransit]);

  function handleClick(info) {
    if (!info.object || !setSelectedStation) return;
    const obj = info.object;
    // Any object with station_id — resolve to full station object
    if (obj.station_id) {
      // Direct station object (has capacity field)
      if (obj.capacity != null) {
        setSelectedStation(obj);
        return;
      }
      // Trend or other layer — look up the full station
      const match = liveStations.find((s) => s.station_id === obj.station_id);
      if (match) setSelectedStation(match);
    }
  }

  function getCursor({ isHovering }) {
    return isHovering ? "pointer" : "grab";
  }

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={({ viewState: vs }) => setViewState(vs)}
      controller={true}
      layers={layers}
      getTooltip={getTooltip}
      onClick={handleClick}
      getCursor={getCursor}
      style={{ position: "absolute", inset: 0 }}
    >
      <MapGL mapStyle={MAP_STYLE} />
    </DeckGL>
  );
}

function getTooltip({ object }) {
  if (!object) return null;
  if (object.from_name) {
    return {
      html: `<b>${object.from_name}</b> &rarr; <b>${object.to_name}</b><br/>${object.count.toLocaleString()} total trips`,
      style: TOOLTIP_STYLE,
    };
  }
  // Live station tooltip
  if (object.station_id && object.num_ebikes_available != null) {
    const hasTrend = object.bike_delta != null;
    const bSign = hasTrend && object.bike_delta > 0 ? "+" : "";
    const eSign = hasTrend && object.ebike_delta > 0 ? "+" : "";
    let html = `<b>${object.name}</b><br/>Ebikes: ${object.num_ebikes_available}${hasTrend ? ` (${eSign}${object.ebike_delta})` : ""}<br/>Bikes: ${object.num_bikes_available}${hasTrend ? ` (${bSign}${object.bike_delta})` : ""}<br/>Docks: ${object.num_docks_available}`;
    if (hasTrend) html += `<br/><span style="color:#999;font-style:italic">Changed in last 5 min</span>`;
    return { html, style: TOOLTIP_STYLE };
  }
  // Live free bike tooltip
  if (object.bike_id) {
    const range = object.current_range_meters != null
      ? `${(object.current_range_meters / 1609.34).toFixed(1)} mi`
      : "unknown";
    return {
      html: `<b>Loose Bike</b><br/>ID: ${object.bike_id}<br/>Range: ${range}`,
      style: TOOLTIP_STYLE,
    };
  }
  if (object.name) {
    return {
      html: `<b>${object.name}</b><br/>${object.departures.toLocaleString()} departures<br/>${object.arrivals.toLocaleString()} arrivals`,
      style: TOOLTIP_STYLE,
    };
  }
  // Transit station (from transit-stations.json)
  if (object.agency) {
    return {
      html: `<b>${transitLabel(object.agency)}</b><br/>${object.agency}`,
      style: TOOLTIP_STYLE,
    };
  }
  return null;
}
