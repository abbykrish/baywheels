import React, { useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";

const INITIAL_VIEW = {
  longitude: -122.42,
  latitude: 37.775,
  zoom: 12.5,
  pitch: 45,
  bearing: -10,
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

export default function MapView({ flows, stations, activeLayer }) {
  const maxCount = useMemo(() => {
    if (!flows.length) return 1;
    return Math.max(...flows.map((f) => f.count));
  }, [flows]);

  const layers = useMemo(() => {
    const result = [];

    if (activeLayer === "arcs") {
      result.push(
        new ArcLayer({
          id: "trip-arcs",
          data: flows,
          getSourcePosition: (d) => d.from,
          getTargetPosition: (d) => d.to,
          getSourceColor: (d) => densityColor(Math.sqrt(d.count / maxCount)),
          getTargetColor: (d) => densityColor(Math.sqrt(d.count / maxCount)),
          getWidth: (d) => 1.5 + (d.count / maxCount) * 4,
          greatCircle: false,
          pickable: true,
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

    return result;
  }, [flows, stations, activeLayer, maxCount]);

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW}
      controller={true}
      layers={layers}
      getTooltip={getTooltip}
      style={{ position: "absolute", inset: 0 }}
    >
      <Map mapStyle={MAP_STYLE} />
    </DeckGL>
  );
}

function getTooltip({ object }) {
  if (!object) return null;
  if (object.from_name) {
    return {
      html: `<b>${object.from_name}</b> &rarr; <b>${object.to_name}</b><br/>${object.count.toLocaleString()} trips`,
      style: TOOLTIP_STYLE,
    };
  }
  if (object.name) {
    return {
      html: `<b>${object.name}</b><br/>${object.departures.toLocaleString()} departures<br/>${object.arrivals.toLocaleString()} arrivals`,
      style: TOOLTIP_STYLE,
    };
  }
  return null;
}
