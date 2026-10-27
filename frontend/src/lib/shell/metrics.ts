import { naira, type CardData } from "@/lib/sherivs-ws/live";

export type MetricTone = "ink" | "green" | "amber" | "blue";

export function formatWidgetMetric(data: CardData | undefined): { text: string; tone: MetricTone } {
  if (!data || data.unavailable) return { text: "—", tone: "ink" };
  if (data.money && typeof data.metric === "number") {
    return { text: naira(data.metric), tone: "green" };
  }
  if (typeof data.metric === "string" && data.metric.includes("%")) {
    return { text: data.metric, tone: data.warn ? "amber" : "green" };
  }
  if (data.metric != null && data.metric !== "") {
    return { text: String(data.metric), tone: data.warn ? "amber" : "blue" };
  }
  return { text: "—", tone: "ink" };
}

const TONES = ["blue", "violet", "cyan", "green"] as const;
export type AccentTone = (typeof TONES)[number];

export function accentTone(index: number): AccentTone {
  return TONES[index % TONES.length] ?? "blue";
}
