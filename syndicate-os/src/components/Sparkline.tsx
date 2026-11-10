interface SparklineProps {
  values: readonly number[];
  /** Value that maps to the top of the chart. */
  max: number;
  className?: string;
}

const WIDTH = 100;
const HEIGHT = 32;

/** Tiny work-rate chart. Decorative: the numbers beside it carry the meaning. */
export function Sparkline({ values, max, className }: SparklineProps) {
  const step = WIDTH / Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => {
      const y = HEIGHT - 2 - (Math.min(value, max) / max) * (HEIGHT - 4);
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
      className={className}
    >
      <polygon points={`0,${HEIGHT} ${points} ${WIDTH},${HEIGHT}`} fill="currentColor" opacity={0.14} />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
