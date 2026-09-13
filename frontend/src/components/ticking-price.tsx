import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * A price/number that visibly flashes when it changes, so a live-polled value (juror share price) reads
 * as actually ticking rather than a static number that happens to refetch. Respects
 * prefers-reduced-motion: the flash becomes an instant color swap with no animation.
 */
export function TickingPrice({ value, format, className = '' }: { value: number; format: (v: number) => string; className?: string }) {
  const prevValueRef = useRef(value);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (value === prevValueRef.current) return;
    setDirection(value > prevValueRef.current ? 'up' : 'down');
    prevValueRef.current = value;
    const timeout = setTimeout(() => setDirection(null), prefersReducedMotion ? 0 : 900);
    return () => clearTimeout(timeout);
  }, [value, prefersReducedMotion]);

  return (
    <motion.span
      className={`tabular-nums transition-colors duration-300 ${
        direction === 'up' ? 'text-correct' : direction === 'down' ? 'text-incorrect' : ''
      } ${className}`}
      animate={direction && !prefersReducedMotion ? { scale: [1, 1.04, 1] } : undefined}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {format(value)}
    </motion.span>
  );
}
