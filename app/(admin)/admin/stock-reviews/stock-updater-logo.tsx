"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

// Coordinates are in the original 1399 × 392 logo. The letters and tagline
// stay fully opaque while the ribbons trace the upper tip, bend and underline.
function prepareRibbon(canvas: HTMLCanvasElement, logo: HTMLImageElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.drawImage(logo, 0, 0, width, height);
  const frame = ctx.getImageData(0, 0, width, height);
  const offsets: number[] = [], alphas: number[] = [], distances: number[] = [];
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const offset = (row * width + col) * 4 + 3;
      if (!frame.data[offset]) continue;
      const x = (col + 0.5) * 1399 / width, y = (row + 0.5) * 392 / height;
      const letters = y >= 124 && y < 272 && x >= (y < 169 ? 425 : 388 + (269 - y) * 0.29);
      if (letters || (x >= 511 && y >= 339)) continue;
      const dx = x - 480, dy = 208 - y;
      const angle = Math.atan2(dy, dx * 0.38);
      const along = (angle < 0 ? angle + 2 * Math.PI : angle) * 325
        + (dy > 0 ? -1 : 1) * Math.max(0, dx);
      offsets.push(offset);
      alphas.push(frame.data[offset]);
      distances.push(along);
      min = Math.min(min, along);
      max = Math.max(max, along);
    }
  }
  const positions = distances.map(distance => (distance - min) / (max - min));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (elapsed: number) => {
    const travel = elapsed / 3700, head = travel % 1.15;
    for (let i = 0; i < offsets.length; i++) {
      let behind = head - positions[i];
      if (behind < 0 && travel >= 1.15) behind += 1.15;
      let opacity = 0;
      if (behind >= 0 && behind < 0.72) {
        const t = behind / 0.72;
        const nose = Math.min(1, behind / 0.017);
        const tail = Math.min(1, Math.max(0, (t - 0.10) / 0.70));
        const feather = Math.min(1, (1 - t) / 0.20);
        opacity = smooth(nose) * (1 - 0.30 * smooth(tail)) * smooth(feather);
      }
      frame.data[offsets[i]] = alphas[i] * opacity;
    }
    ctx.putImageData(frame, 0, 0);
  };
}

export function StockUpdaterLogo() {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = imgRef.current, canvas = canvasRef.current;
    if (!img || !canvas || typeof window.matchMedia !== "function") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let paint: ReturnType<typeof prepareRibbon>;
    let elapsed = 0, last: number | undefined, handle = 0;
    function frame(now: number) {
      if (!paint) return;
      if (last !== undefined) elapsed += Math.min(65, now - last);
      last = now;
      paint(elapsed);
      handle = requestAnimationFrame(frame);
    }
    const refresh = () => {
      cancelAnimationFrame(handle);
      last = undefined;
      img.style.opacity = "1";
      canvas.hidden = true;
      if (motion.matches || document.hidden || !img.complete || !img.naturalWidth) return;
      paint ??= prepareRibbon(canvas, img);
      if (!paint) return;
      paint(elapsed);
      canvas.hidden = false;
      img.style.opacity = "0";
      handle = requestAnimationFrame(frame);
    };
    refresh();
    img.addEventListener("load", refresh);
    motion.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelAnimationFrame(handle);
      img.removeEventListener("load", refresh);
      motion.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return <div className="relative mx-auto w-4/5 max-w-[295px]">
    <Image ref={imgRef} src="/images/logo-itrader-hq.png" alt="iTrader.im" unoptimized loading="eager"
      width={1399} height={392} className="block h-auto w-full" />
    <canvas ref={canvasRef} width={420} height={118} hidden aria-hidden="true" className="absolute inset-0 h-full w-full" />
  </div>;
}
