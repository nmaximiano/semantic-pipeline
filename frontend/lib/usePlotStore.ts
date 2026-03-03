"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as plotStorage from "@/lib/plotStorage";

export interface StoredPlot {
  id: string;
  dataUrl: string;
  source: "user" | "agent";
  timestamp: number;
  code?: string;
}

let plotIdCounter = Date.now();

function imageBitmapToDataUrl(img: ImageBitmap): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function usePlotStore(sessionId: string, duckdbReady: boolean) {
  const [plots, setPlots] = useState<StoredPlot[]>([]);
  const plotsRef = useRef(plots);
  plotsRef.current = plots;

  // Load persisted plots on mount
  const loaded = useRef(false);
  useEffect(() => {
    if (!duckdbReady || loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const saved = await plotStorage.getPlots(sessionId);
        if (saved.length > 0) {
          setPlots(saved);
          console.log(`[plots] Restored ${saved.length} plots from storage`);
        }
      } catch (e) {
        console.error("[plots] Failed to load plots:", e);
      }
    })();
  }, [duckdbReady, sessionId]);

  const addPlots = useCallback(
    (images: ImageBitmap[], source: "user" | "agent", code?: string) => {
      const newPlots: StoredPlot[] = [];
      for (const img of images) {
        const dataUrl = imageBitmapToDataUrl(img);
        if (!dataUrl) continue;
        newPlots.push({
          id: `plot_${++plotIdCounter}`,
          dataUrl,
          source,
          timestamp: Date.now(),
          code,
        });
      }

      if (newPlots.length > 0) {
        setPlots((prev) => [...prev, ...newPlots]);
        plotStorage.savePlots(sessionId, newPlots).catch((e) =>
          console.error("[plots] Failed to save plots:", e)
        );
      }
    },
    [sessionId]
  );

  const removePlot = useCallback(
    (plotId: string) => {
      setPlots((prev) => prev.filter((p) => p.id !== plotId));
      plotStorage.deletePlot(sessionId, plotId).catch((e) =>
        console.error("[plots] Failed to delete plot:", e)
      );
    },
    [sessionId]
  );

  const clearPlots = useCallback(() => {
    setPlots([]);
    plotStorage.clearPlots(sessionId).catch((e) =>
      console.error("[plots] Failed to clear plots:", e)
    );
  }, [sessionId]);

  return { plots, addPlots, removePlot, clearPlots };
}
