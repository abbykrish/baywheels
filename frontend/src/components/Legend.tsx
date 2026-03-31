import React from "react";

export default function Legend({ activeLayer }) {
  if (activeLayer !== "arcs" && activeLayer !== "heatmap") return null;

  return (
    <div className="fixed md:absolute bottom-[68px] left-3 md:bottom-6 md:left-auto md:right-[380px] bg-white/92 backdrop-blur-md rounded-lg border border-black/8 shadow-sm px-3 py-2.5 flex flex-col gap-1 text-[11px] text-gray-900 z-10">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Trip Density</div>
      <div
        className="w-28 h-2.5 rounded-full"
        style={{ background: "linear-gradient(to right, #4285f4, #00b4d8, #388e3c, #ebc82d, #eb8c2d, #dc2626)" }}
      />
      <div className="flex justify-between text-[9px] text-gray-400">
        <span>Low</span>
        <span>High</span>
      </div>
    </div>
  );
}
