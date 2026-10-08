import { cn } from "@/lib/utils";

export interface SherivsSymbolProps {
  className?: string;
  size?: number;
  glow?: boolean;
}

/**
 * Sherivs canonical brand symbol:
 * An interconnected hexagonal nexus representing reality, intelligence, and governed evidence.
 */
export function SherivsSymbol({ className, size = 28, glow = false }: SherivsSymbolProps) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center shrink-0 rounded-lg",
        glow && "sherivs-glow-cyan",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="transition-transform duration-300 hover:scale-105"
      >
        <path
          d="M16 2L28 8.9282V23.0718L16 30L4 23.0718V8.9282L16 2Z"
          stroke="url(#sherivs-sym-grad)"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="16" r="3.5" fill="#06b6d4" />
        <path
          d="M16 2V12.5M28 23.0718L19.0311 17.75M4 23.0718L12.9689 17.75"
          stroke="url(#sherivs-sym-inner)"
          strokeWidth="1.25"
          strokeDasharray="2 2"
        />
        <defs>
          <linearGradient id="sherivs-sym-grad" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#06b6d4" />
            <stop offset="0.5" stopColor="#3b82f6" />
            <stop offset="1" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id="sherivs-sym-inner" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#06b6d4" stopOpacity="0.8" />
            <stop offset="1" stopColor="#3b82f6" stopOpacity="0.4" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export interface SherivsLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showTagline?: boolean;
  glow?: boolean;
}

export function SherivsLogo({
  className,
  size = "md",
  showTagline = false,
  glow = false,
}: SherivsLogoProps) {
  const iconSizes = { sm: 22, md: 28, lg: 36, xl: 44 };
  const textSizes = {
    sm: "text-base tracking-tight",
    md: "text-lg tracking-tight font-bold",
    lg: "text-2xl tracking-tight font-extrabold",
    xl: "text-3xl tracking-tight font-black",
  };

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <SherivsSymbol size={iconSizes[size]} glow={glow} />
      <div className="flex flex-col leading-none">
        <span className={cn("font-display font-bold text-foreground tracking-wider uppercase", textSizes[size])}>
          Sherivs
        </span>
        {showTagline && (
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1 font-mono">
            Institutional Intelligence
          </span>
        )}
      </div>
    </div>
  );
}

export interface JarvisGlyphProps {
  className?: string;
  size?: number;
  state?: "idle" | "thinking" | "verified" | "action";
}

/**
 * Jarvis Executive Intelligence visual glyph.
 */
export function JarvisGlyph({ className, size = 22, state = "idle" }: JarvisGlyphProps) {
  const stateColors = {
    idle: "#06b6d4",
    thinking: "#8b5cf6",
    verified: "#10b981",
    action: "#f59e0b",
  };

  return (
    <div
      className={cn("relative inline-flex items-center justify-center shrink-0", className)}
      style={{ width: size, height: size }}
      aria-label={`Jarvis Intelligence (${state})`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(state === "thinking" && "animate-spin")}
        style={{ animationDuration: "3s" }}
      >
        <polygon
          points="12 2, 21 7, 21 17, 12 22, 3 17, 3 7"
          stroke={stateColors[state]}
          strokeWidth="1.5"
          fill="none"
        />
        <circle cx="12" cy="12" r="2.5" fill={stateColors[state]} />
      </svg>
      {state === "thinking" && (
        <span className="absolute -inset-1 rounded-full animate-ping opacity-25 bg-cyan-400" />
      )}
    </div>
  );
}

export interface StatusBeaconProps {
  status: "operational" | "degraded" | "incident" | "maintenance";
  label?: string;
  className?: string;
}

export function StatusBeacon({ status, label, className }: StatusBeaconProps) {
  const colors = {
    operational: "bg-emerald-500 text-emerald-400 border-emerald-500/30",
    degraded: "bg-amber-500 text-amber-400 border-amber-500/30",
    incident: "bg-rose-500 text-rose-400 border-rose-500/30",
    maintenance: "bg-cyan-500 text-cyan-400 border-cyan-500/30",
  };

  const defaultLabels = {
    operational: "All Systems Operational",
    degraded: "Degraded Performance",
    incident: "Active Incident",
    maintenance: "Scheduled Maintenance",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border bg-black/40",
        colors[status],
        className,
      )}
      role="status"
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            status === "operational" ? "bg-emerald-400" : "bg-amber-400",
          )}
        />
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            status === "operational" ? "bg-emerald-500" : "bg-amber-500",
          )}
        />
      </span>
      <span>{label ?? defaultLabels[status]}</span>
    </div>
  );
}

export interface ConfidenceMeterProps {
  confidence: number; // 0 to 1
  label?: string;
  className?: string;
}

export function ConfidenceMeter({ confidence, label, className }: ConfidenceMeterProps) {
  const pct = Math.round(Math.min(Math.max(confidence, 0), 1) * 100);
  const color =
    pct >= 90 ? "bg-emerald-500 text-emerald-400" : pct >= 70 ? "bg-cyan-500 text-cyan-400" : "bg-amber-500 text-amber-400";

  return (
    <div className={cn("inline-flex items-center gap-2 font-mono text-xs", className)}>
      {label && <span className="text-muted-foreground">{label}:</span>}
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all duration-500", color.split(" ")[0])} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("font-semibold", color.split(" ")[1])}>{pct}%</span>
    </div>
  );
}

export type CognitiveClassification = "observation" | "inference" | "recommendation" | "action" | "evidence" | "verification";

export interface CognitivePillProps {
  type: CognitiveClassification;
  label?: string;
  className?: string;
}

export function CognitivePill({ type, label, className }: CognitivePillProps) {
  const styles: Record<CognitiveClassification, string> = {
    observation: "sherivs-observation-pill",
    inference: "sherivs-inference-pill",
    recommendation: "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/25",
    action: "sherivs-action-pill",
    evidence: "sherivs-evidence-pill",
    verification: "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  };

  const defaultText: Record<CognitiveClassification, string> = {
    observation: "Observation",
    inference: "Inference",
    recommendation: "Recommendation",
    action: "Action",
    evidence: "Evidence",
    verification: "Verified",
  };

  return <span className={cn(styles[type], className)}>{label ?? defaultText[type]}</span>;
}
