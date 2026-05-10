"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A wide draggable scroll rail anchored to the right edge of a scroll
 * container. Lets the user scroll the schedule grid without their finger
 * landing on an event chip (which would consume the touch). The thumb's
 * position and size mirror the container's scrollTop / scrollHeight; drags
 * translate finger movement directly into scrollTop changes.
 */
export function MobileScrollRail({
  scrollRef,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ topPct: 0, heightPct: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const heightPct = (el.clientHeight / el.scrollHeight) * 100;
      const topPct = (el.scrollTop / el.scrollHeight) * 100;
      setThumb({ topPct, heightPct });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef]);

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    const scNullable = scrollRef.current;
    const track = trackRef.current;
    if (!scNullable || !track) return;
    const sc: HTMLDivElement = scNullable;
    e.preventDefault();
    const trackRect = track.getBoundingClientRect();
    const startY = e.clientY;
    const startScroll = sc.scrollTop;
    const scrollHeight = sc.scrollHeight;
    function onMove(ev: PointerEvent) {
      // Map finger movement on the rail to scrollTop linearly: a drag
      // covering the full rail traverses the whole scrollHeight.
      const dy = ev.clientY - startY;
      const ratio = dy / trackRect.height;
      sc.scrollTop = startScroll + ratio * scrollHeight;
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Hide entirely when there's nothing to scroll.
  if (thumb.heightPct >= 99.5) return null;

  return (
    <div
      ref={trackRef}
      className="pointer-events-none absolute right-0 top-0 bottom-0 z-20 w-5"
    >
      <div className="absolute inset-y-1 right-1 w-1 rounded-full bg-foreground/10" />
      <div
        onPointerDown={startDrag}
        className="pointer-events-auto absolute right-0.5 w-4 rounded-full bg-foreground/40 touch-none active:bg-foreground/60"
        style={{
          top: `${thumb.topPct}%`,
          height: `${Math.max(thumb.heightPct, 8)}%`,
        }}
      />
    </div>
  );
}
