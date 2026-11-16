import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** One line of text, its font shrunk until it fits (down to `min` px). */
export function FitText({
  children,
  max,
  min = 7,
  className = '',
}: {
  children: ReactNode;
  /** Largest size in px; left out, the size the classes give (so sm: sizes work). */
  max?: number;
  min?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = max === undefined ? '' : `${max}px`;
      let size = parseFloat(getComputedStyle(el).fontSize) || 11;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > min) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    watch?.observe(el);
    return () => watch?.disconnect();
  }, [children, max, min]);
  return (
    <span
      ref={ref}
      className={`block w-full overflow-hidden whitespace-nowrap ${className}`}
      style={max === undefined ? undefined : { fontSize: max }}
    >
      {children}
    </span>
  );
}
