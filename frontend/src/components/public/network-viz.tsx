/**
 * Restrained constellation: people, organizations, agents, twins, compute.
 * CSS-only motion; disabled under prefers-reduced-motion.
 */
export function NetworkViz({ className = "" }: { className?: string }) {
  return (
    <figure
      className={`sherivs-glass relative overflow-hidden rounded-[var(--sherivs-radius-lg)] ${className}`}
      aria-labelledby="network-viz-caption"
    >
      <svg viewBox="0 0 640 420" role="img" className="h-auto w-full">
        <title id="network-viz-caption">
          Sherivs connecting people, organizations, AI agents, digital twins, and compute
        </title>
        <defs>
          <radialGradient id="nv-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--sherivs-blue)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--sherivs-obsidian)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="640" height="420" fill="var(--sherivs-obsidian)" />
        <circle cx="320" cy="210" r="180" fill="url(#nv-glow)" />
        <g
          fill="none"
          stroke="var(--sherivs-blue)"
          strokeOpacity="0.45"
          strokeWidth="1.2"
          className="sherivs-motion-loop"
          style={{ strokeDasharray: "4 8", animation: "sherivs-dash 8s linear infinite" }}
        >
          <line x1="320" y1="210" x2="140" y2="90" />
          <line x1="320" y1="210" x2="500" y2="90" />
          <line x1="320" y1="210" x2="110" y2="300" />
          <line x1="320" y1="210" x2="530" y2="300" />
          <line x1="140" y1="90" x2="500" y2="90" />
          <line x1="110" y1="300" x2="530" y2="300" />
        </g>
        <Node cx={320} cy={210} label="Sherivs" sub="Compute" accent />
        <Node cx={140} cy={90} label="People" />
        <Node cx={500} cy={90} label="Organizations" />
        <Node cx={110} cy={300} label="AI agents" />
        <Node cx={530} cy={300} label="Digital twins" />
      </svg>
    </figure>
  );
}

function Node({
  cx,
  cy,
  label,
  sub,
  accent,
}: {
  cx: number;
  cy: number;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={accent ? 28 : 16}
        fill={accent ? "var(--sherivs-blue)" : "var(--sherivs-midnight)"}
        stroke={accent ? "var(--sherivs-cyan)" : "var(--sherivs-violet)"}
        strokeWidth="1.5"
        className="sherivs-motion-loop"
        style={{ animation: "sherivs-pulse-node 4.5s ease-in-out infinite" }}
      />
      <text
        x={cx}
        y={cy + (accent ? 48 : 34)}
        textAnchor="middle"
        fill="var(--sherivs-white)"
        fontSize="12"
        fontFamily="var(--font-sans)"
      >
        {label}
      </text>
      {sub ? (
        <text
          x={cx}
          y={cy + 64}
          textAnchor="middle"
          fill="var(--sherivs-muted)"
          fontSize="10"
          fontFamily="var(--font-sans)"
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}
