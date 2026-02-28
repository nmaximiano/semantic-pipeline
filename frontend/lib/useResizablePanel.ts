"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const PANEL_MIN = 360;
const PANEL_MAX = 720;
const PANEL_DEFAULT = 480;

export function useResizablePanel() {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const isDraggingPanel = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handlePanelDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPanel.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [panelWidth]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingPanel.current) return;
      const delta = dragStartX.current - e.clientX;
      const newWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, dragStartWidth.current + delta));
      setPanelWidth(newWidth);
    }
    function onMouseUp() {
      if (!isDraggingPanel.current) return;
      isDraggingPanel.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return { panelWidth, handlePanelDragStart };
}
