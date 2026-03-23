import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const STORAGE_KEY = "baywheels_welcomed";

export default function WelcomeModal() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setShow(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setShow(false);
  }

  if (!show) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={dismiss}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-bold text-gray-900">Welcome to Bay Wheels</h2>
          <p className="text-sm text-gray-500 mt-1">A real-time and historical dashboard for San Francisco's bikeshare system.</p>
        </div>

        <div className="flex flex-col gap-2.5 text-sm text-gray-700">
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
            <span><strong>Live</strong> shows real-time ebike availability at every station, updated every minute.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
            <span><strong>Historical</strong> shows the most popular routes as arcs across the map.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
            <span><strong>Tap any station</strong> on the live map to see its availability history and ebike trends.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">4</span>
            <span>Use <strong>Details</strong> for top routes, station rankings, and route lookup.</span>
          </div>
        </div>

        <button
          onClick={dismiss}
          className="mt-1 w-full py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg border-none cursor-pointer hover:bg-purple-700 transition-colors"
        >
          Get Started
        </button>

        <p className="text-[10px] text-gray-400 text-center">
          made by <a href="https://abbykrishnan.com" target="_blank" rel="noopener noreferrer" className="underline">Abby Krishnan</a> · data from <a href="https://www.lyft.com/bikes/bay-wheels/system-data" target="_blank" rel="noopener noreferrer" className="underline">Lyft</a>
        </p>
      </div>
    </div>,
    document.body
  );
}
