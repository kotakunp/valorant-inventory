import { useEffect, useState, type RefObject } from "react";
import { CANVAS_H, CANVAS_W } from "./Showcase";

/** Breathing room between the stage edge and the scaled canvas. */
export const STAGE_PAD = 24;

/** Scale that fits the fixed 1280×720 canvas inside `ref` on both axes. */
export function useFitScale(ref: RefObject<HTMLElement>, deps: unknown[], max = 1.5): number {
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const w = el.clientWidth - STAGE_PAD * 2;
      const h = el.clientHeight - STAGE_PAD * 2;
      if (w > 0 && h > 0) setScale(Math.min(max, Math.max(0.1, Math.min(w / CANVAS_W, h / CANVAS_H))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, deps);
  return scale;
}
