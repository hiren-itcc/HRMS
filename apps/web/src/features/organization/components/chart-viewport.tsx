'use client';

import { cn } from '@hrms/ui/lib/utils';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { IconAction } from '@/components/icon-action';

/**
 * The pane the org chart is drawn in: zoom, fit to screen, and drag to pan.
 *
 * It exists because the chart can now have several branches open at once, and
 * the width of a level is the sum of every expanded branch in it. Without a way
 * to shrink the whole thing, the second open branch pushes the first off the
 * screen — which is exactly why the previous version only allowed one.
 *
 * **`zoom`, not `transform: scale()`,** and the difference is not cosmetic. A
 * transform paints at a different size but lays out at the original one, so a
 * chart scaled to 0.5 still reserves its full width inside this scroll
 * container: the scrollbar would refuse to shrink on zoom out, and on zoom in
 * the container would not extend far enough to reach the right-hand cards.
 * `zoom` reflows, so the scroll extents come out right on their own, and text
 * is laid out at the new size rather than bitmap-scaled, so it stays crisp.
 *
 * Below `md` none of this is rendered. The chart is an indented list there, and
 * a list is not a thing anybody wants to pinch-zoom.
 */

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.5;
const STEP = 0.1;
/** Breathing room, so a fitted chart is not flush against both edges. */
const GUTTER = 24;

const clamp = (n: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));

/**
 * Adding 0.1 repeatedly leaves float dust — 1.0000000000000002 renders as
 * "100%" while failing every `>= MAX_ZOOM` check, so the zoom-in button never
 * disables. Rounding to whole percents is also exactly what the readout shows.
 */
const round = (n: number) => Math.round(n * 100) / 100;

export function ChartViewport({
  children,
  fitKey,
}: {
  children: ReactNode;
  /**
   * Bump to re-fit. The caller owns the tree, so it is the only thing that
   * knows when the content changed enough to be worth re-measuring — opening
   * one card is not, expanding the whole company is.
   */
  fitKey: number;
}) {
  const [zoom, setZoom] = useState(1);
  const [grabbing, setGrabbing] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  const fitToScreen = useCallback(() => {
    const vp = viewport.current;
    const el = content.current;
    if (!vp || !el) return;
    // The measured width already has the current zoom baked into it, so divide
    // it back out to get the width the chart would have at 100%.
    const natural = el.getBoundingClientRect().width / zoom;
    // jsdom measures everything as zero, and so does a first paint that has not
    // laid out yet. Without this the next line is a division by zero and the
    // chart renders at `zoom: NaN`, which blanks it.
    if (!natural) return;
    // Never past 100%: fitting a three-person company should not blow it up to
    // fill a 27-inch monitor.
    setZoom(round(Math.max(MIN_ZOOM, Math.min(1, (vp.clientWidth - GUTTER) / natural))));
  }, [zoom]);

  // Fits on mount, and again whenever the caller says the shape changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey is the trigger; depending on fitToScreen would re-fit on its own result, since it closes over the zoom it sets
  useEffect(() => {
    fitToScreen();
  }, [fitKey]);

  /*
   * Ctrl/⌘ + wheel zooms and a plain wheel scrolls, which is what every map and
   * canvas does. Registered by hand rather than as an `onWheel` prop because
   * React attaches wheel listeners as passive, and a passive listener cannot
   * call `preventDefault` — so the browser's own page zoom would fire too.
   */
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => round(clamp(z - Math.sign(e.deltaY) * STEP)));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const vp = viewport.current;
    if (!vp || e.button !== 0) return;
    // Every card is a link and every toggle is a button. Starting a drag on one
    // would swallow the click that was actually meant.
    if ((e.target as HTMLElement).closest('a, button')) return;
    drag.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop };
    setGrabbing(true);
    vp.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const vp = viewport.current;
    const from = drag.current;
    if (!vp || !from) return;
    vp.scrollLeft = from.left - (e.clientX - from.x);
    vp.scrollTop = from.top - (e.clientY - from.y);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setGrabbing(false);
    const vp = viewport.current;
    // Releasing a capture that was never taken throws, and a pointer can be
    // lost to the OS between down and up.
    if (vp?.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="relative">
      {/* Floats over the chart at the top right, the way the reference does.
          Hidden below md, where there is nothing to zoom.

          `right-3` rather than `right-2` so it clears the horizontal
          scrollbar's corner on the platforms that reserve one. It used to sit
          on top of the vertical scrollbar; that scrollbar should no longer
          exist at all — see the viewport below — but two pixels of clearance
          costs nothing and this is a control people have to hit. */}
      <div className="absolute top-2 right-3 z-10 hidden items-center gap-0.5 rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur md:flex">
        <IconAction label="Fit to screen" icon={Maximize2} size="icon-sm" onClick={fitToScreen} />
        <IconAction
          label="Zoom out"
          icon={Minus}
          size="icon-sm"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoom((z) => round(clamp(z - STEP)))}
        />
        {/* Announced, because the two buttons either side of it give no other
            feedback that anything happened. */}
        <output className="w-11 text-center text-muted-foreground text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </output>
        <IconAction
          label="Zoom in"
          icon={Plus}
          size="icon-sm"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom((z) => round(clamp(z + STEP)))}
        />
      </div>

      {/*
        Horizontal only, and no height cap.

        A tree grows downward, and the page already scrolls — capping this at
        70vh bought a second, nested scrollbar that appeared on any window
        shorter than the chart, sat under the zoom controls, and scrolled the
        chart when somebody meant to scroll the page. Width is the axis that
        genuinely needs its own scroller, because a row of siblings is wider
        than the screen long before the tree is taller than it.

        `overflow-y` computes to `auto` rather than `visible` once `overflow-x`
        is set — that is the spec, not an oversight — so the tree's own
        bottom padding is what keeps the disclosure circles inside the box and
        the vertical scrollbar away.
      */}
      <div
        ref={viewport}
        className={cn('overflow-x-auto pb-2 md:cursor-grab', grabbing && 'md:cursor-grabbing')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/*
          `w-max` is load-bearing, not tidiness. As a plain block this div would
          be exactly as wide as the scroll container — the chart inside is
          `width: max-content` and simply overflows it — so measuring this
          element would hand `fitToScreen` the viewport's own width, a ratio of
          almost exactly 1, and a Fit button that visibly did nothing. Hugging
          the content is what makes the measurement mean anything.

          `org-zoom` is what print.css resets: a chart left at 40% to read the
          whole company on screen should not print at 40%.
        */}
        <div ref={content} className="org-zoom mx-auto w-max" style={{ zoom }}>
          {children}
        </div>
      </div>
    </div>
  );
}
