/**
 * Explanatory diagrams for the public narrative.
 *
 * These are conceptual models, not data: they carry no numbers, no live state
 * and no customer claims. Each has a text alternative.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useId, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  ARCHITECTURE_LAYERS,
  EXPERIENCE_INPUTS,
  MISSION_STAGES,
} from "@/lib/experience-system/public-content";
import type { SherivsPlane } from "@/lib/experience-system/design-tokens";

const PLANE_COPY: ReadonlyArray<{ plane: SherivsPlane; title: string; sub: string }> = [
  { plane: "reality", title: "Reality", sub: "Verified records, state, history" },
  { plane: "intelligence", title: "Intelligence", sub: "Context · memory · knowledge" },
  { plane: "action", title: "Action", sub: "Missions · governed workers" },
  { plane: "evidence", title: "Evidence", sub: "Proof · verification · audit" },
];

/** Four stacked planes: the spatial model Sherivs is organized around. */
export function PlaneStack({ className }: { className?: string }) {
  const titleId = useId();
  return (
    <figure className={cn("m-0", className)}>
      <svg
        viewBox="0 0 520 440"
        role="img"
        aria-labelledby={titleId}
        className="h-auto w-full"
      >
        <title id={titleId}>
          Four planes from top to bottom: Reality, Intelligence, Action, Evidence.
        </title>
        <line x1="150" y1="40" x2="150" y2="400" stroke="var(--sv-border-strong)" strokeWidth="1" strokeDasharray="3 5" />
        {PLANE_COPY.map((p, i) => {
          const cy = 70 + i * 100;
          return (
            <g
              key={p.plane}
              className="sv-rise"
              style={{ "--i": i } as CSSProperties}
              data-plane={p.plane}
            >
              <polygon
                points={`150,${cy - 38} 290,${cy} 150,${cy + 38} 10,${cy}`}
                fill="var(--sv-surface-2)"
                stroke={`var(--sv-plane-${p.plane})`}
                strokeWidth="1.5"
              />
              <polygon
                points={`150,${cy - 20} 220,${cy} 150,${cy + 20} 80,${cy}`}
                fill="none"
                stroke={`var(--sv-plane-${p.plane})`}
                strokeOpacity="0.5"
                strokeWidth="1"
              />
              <circle cx="150" cy={cy} r="4" fill={`var(--sv-plane-${p.plane})`} />
              <text x="312" y={cy - 4} fill="var(--sv-text)" fontSize="19" fontWeight="600" fontFamily="var(--sv-font-sans)">
                {p.title}
              </text>
              <text x="312" y={cy + 18} fill="var(--sv-text-muted)" fontSize="13" fontFamily="var(--sv-font-sans)">
                {p.sub}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Mission governance path as an accessible tablist (arrow keys, home/end). */
export function MissionFlow({ className }: { className?: string }) {
  const [value, setValue] = useState(MISSION_STAGES[0].key);
  return (
    <TabsPrimitive.Root value={value} onValueChange={setValue} className={className}>
      <TabsPrimitive.List
        aria-label="Mission lifecycle"
        className="grid grid-cols-2 gap-px bg-sv-border sm:grid-cols-3 lg:grid-cols-6"
      >
        {MISSION_STAGES.map((stage, i) => (
          <TabsPrimitive.Trigger
            key={stage.key}
            value={stage.key}
            data-plane={stage.plane}
            className="sv-pressable sv-touch group relative bg-sv-surface-1 px-4 py-4 text-left data-[state=active]:bg-sv-surface-3"
          >
            <span className="sv-data block text-sv-text-subtle">{String(i + 1).padStart(2, "0")}</span>
            <span className="mt-1 block font-medium">{stage.title}</span>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-0.5 scale-x-0 bg-[var(--plane)] transition-transform data-[on=true]:scale-x-100 group-data-[state=active]:scale-x-100"
            />
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {MISSION_STAGES.map((stage) => (
        <TabsPrimitive.Content
          key={stage.key}
          value={stage.key}
          data-plane={stage.plane}
          className="border-l-2 border-[var(--plane)] bg-sv-surface-1 p-6 outline-none sm:p-8"
        >
          <p className="sv-h3">{stage.title}</p>
          <p className="sv-body mt-2 max-w-prose text-sv-text-muted">{stage.body}</p>
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

/** Inputs → Experience Configuration (the governed experience contract). */
export function ExperienceEquation({ className }: { className?: string }) {
  return (
    <div className={cn("grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,18rem)]", className)}>
      <ul aria-label="Inputs" className="flex flex-wrap gap-2">
        {EXPERIENCE_INPUTS.map((input) => (
          <li
            key={input.key}
            className="sv-small border border-sv-border-strong bg-sv-surface-1 px-3 py-2 rounded-[var(--sv-radius-sm)]"
          >
            {input.label}
          </li>
        ))}
      </ul>
      <span aria-hidden="true" className="sv-data hidden text-2xl text-sv-text-subtle lg:block">
        →
      </span>
      <div className="border border-[var(--sv-plane-intelligence)] bg-sv-accent-wash p-5 rounded-[var(--sv-radius-md)]">
        <p className="sv-label text-sv-accent-text">Output</p>
        <p className="sv-h4 mt-1">Experience configuration</p>
        <p className="sv-small mt-1 text-sv-text-muted">
          Schema-validated, authorization-filtered, and only ever narrower than what the viewer may do.
        </p>
      </div>
    </div>
  );
}

export function LayerStack({ className }: { className?: string }) {
  return (
    <ol className={cn("grid gap-px bg-sv-border", className)}>
      {ARCHITECTURE_LAYERS.map((layer, i) => (
        <li
          key={layer.key}
          className="grid gap-1 bg-sv-surface-1 px-5 py-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6"
        >
          <span className="sv-data text-sv-text-subtle">
            {String(i + 1).padStart(2, "0")} · <span className="font-medium text-sv-text">{layer.title}</span>
          </span>
          <span className="text-sv-text-muted">{layer.body}</span>
        </li>
      ))}
    </ol>
  );
}
