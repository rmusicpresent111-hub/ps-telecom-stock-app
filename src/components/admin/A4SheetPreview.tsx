'use client';

/**
 * A4Preview — renders a print document (the HTML produced by print.ts)
 * inside a scaled iframe that looks like an A4 sheet on screen.
 *
 * The iframe is scaled to fit the container width and its height is
 * measured from the rendered document, so multi-page bills are not cut.
 * Purely visual — printing still goes through the hidden-iframe engine.
 */

import { useEffect, useRef, useState } from 'react';

const A4_W = 794; // px @96dpi = 210mm
const A4_MIN_H = 1123; // px = 297mm

export default function A4Preview({ html, ariaLabel }: { html: string; ariaLabel?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.75);
  const [docH, setDocH] = useState(A4_MIN_H);

  // fit the sheet to the container width
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 16) / A4_W)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // re-measure whenever the document content changes
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const d = frameRef.current?.contentDocument;
        if (d?.body) setDocH(Math.max(A4_MIN_H, d.body.scrollHeight + 8));
      } catch {
        /* cross-origin guard — keep the A4 fallback height */
      }
    }, 120);
    return () => window.clearTimeout(id);
  }, [html]);

  return (
    <div
      ref={wrapRef}
      className="w-full rounded-xl border border-[var(--psa-border)] bg-[#E7EAEE] overflow-x-hidden overflow-y-auto p-2"
      style={{ maxHeight: '64vh' }}
    >
      <div
        className="mx-auto bg-white shadow-[0_2px_14px_rgba(16,24,40,0.20)]"
        style={{ width: Math.round(A4_W * scale), height: Math.round(docH * scale), position: 'relative' }}
        role="figure"
        aria-label={ariaLabel || 'A4 document preview'}
      >
        <iframe
          ref={frameRef}
          title={ariaLabel || 'A4 document preview'}
          srcDoc={html}
          onLoad={() => {
            try {
              const d = frameRef.current?.contentDocument;
              if (d?.body) setDocH(Math.max(A4_MIN_H, d.body.scrollHeight + 8));
            } catch {
              /* ignore */
            }
          }}
          style={{
            width: A4_W,
            height: docH,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
            background: '#fff',
          }}
        />
      </div>
    </div>
  );
}
