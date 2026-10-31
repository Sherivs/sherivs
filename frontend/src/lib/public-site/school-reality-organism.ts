/**
 * Geometry for the desktop School Reality organism.
 * Coordinates are viewBox units. Strokes stay outside label rectangles.
 */
import {
  SCHOOL_REALITY_BRANCHES,
  SCHOOL_REALITY_PATHS,
  type SchoolRealityBranch,
} from "@/lib/public-site/school-reality-map";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OrganismLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
  size: number;
  rect: Box;
}

export interface OrganismNode {
  id: string;
  branchId: string;
  kind: "domain" | "activity";
  label?: string;
  point: Point;
}

export interface OrganismCurve {
  id: string;
  kind: "trunk" | "twig" | "arc" | "converge";
  pathId?: string;
  d: string;
  samples: Point[];
}

export interface OrganismHit {
  branchId: string;
  rect: Box;
}

export interface OrganismLayout {
  width: number;
  height: number;
  nucleus: { cx: number; cy: number; rx: number; ry: number };
  labels: OrganismLabel[];
  nodes: OrganismNode[];
  curves: OrganismCurve[];
  hits: OrganismHit[];
  clearOfLabels: boolean;
}

const WIDTH = 1000;
const HEIGHT = 980;
const NUCLEUS = { cx: 500, cy: 400, rx: 86, ry: 58 };
const LEFT_DOMAIN_X = 268;
const RIGHT_DOMAIN_X = 732;
const LEFT_ACTIVITY_X = 228;
const RIGHT_ACTIVITY_X = 772;
const LEFT_TEXT_X = 210;
const RIGHT_TEXT_X = 790;
const DOMAIN_Y = [130, 330, 530, 730];
const ACTIVITY_SIZE = 12;
const HEADING_SIZE = 13;
const LANE_Y = [820, 844, 868];

export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += fontSize * 0.34;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) width += fontSize * 0.7;
    else if (ch === "&") width += fontSize * 0.72;
    else width += fontSize * 0.58;
  }
  return width * 1.06;
}

function rectFor(
  text: string,
  x: number,
  y: number,
  anchor: "start" | "end" | "middle",
  size: number,
): Box {
  const w = estimateTextWidth(text, size);
  const h = size * 1.2;
  const top = y - size * 0.78;
  if (anchor === "end") return { x: x - w, y: top, w, h };
  if (anchor === "middle") return { x: x - w / 2, y: top, w, h };
  return { x, y: top, w, h };
}

function inflate(box: Box, pad: number): Box {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

function contains(box: Box, point: Point): boolean {
  return point.x > box.x && point.x < box.x + box.w && point.y > box.y && point.y < box.y + box.h;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function ellipseEdge(tx: number, ty: number): Point {
  const dx = tx - NUCLEUS.cx;
  const dy = ty - NUCLEUS.cy;
  const denom = Math.hypot(dx / NUCLEUS.rx, dy / NUCLEUS.ry) || 1;
  return { x: NUCLEUS.cx + dx / denom, y: NUCLEUS.cy + dy / denom };
}

function cubic(a: Point, b: Point, c: Point, d: Point, steps = 16): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
      y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
    });
  }
  return points;
}

function quad(a: Point, b: Point, c: Point, steps = 12): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u ** 2 * a.x + 2 * u * t * b.x + t ** 2 * c.x,
      y: u ** 2 * a.y + 2 * u * t * b.y + t ** 2 * c.y,
    });
  }
  return points;
}

function fmt(n: number): string {
  return n.toFixed(1);
}

function sideOf(branch: SchoolRealityBranch): "left" | "right" {
  return branch.side;
}

export function organismLayout(): OrganismLayout {
  const labels: OrganismLabel[] = [];
  const nodes: OrganismNode[] = [];
  const curves: OrganismCurve[] = [];
  const hits: OrganismHit[] = [];
  const activityPoint = new Map<string, Point>();

  const left = SCHOOL_REALITY_BRANCHES.filter((branch) => branch.side === "left");
  const right = SCHOOL_REALITY_BRANCHES.filter((branch) => branch.side === "right");

  const placeDomain = (branch: SchoolRealityBranch, row: number) => {
    const side = sideOf(branch);
    const domainX = side === "left" ? LEFT_DOMAIN_X : RIGHT_DOMAIN_X;
    const activityX = side === "left" ? LEFT_ACTIVITY_X : RIGHT_ACTIVITY_X;
    const textX = side === "left" ? LEFT_TEXT_X : RIGHT_TEXT_X;
    const anchor = side === "left" ? "end" : "start";
    const y = DOMAIN_Y[row] ?? 0;
    const domain: Point = { x: domainX, y };
    nodes.push({ id: `domain-${branch.id}`, branchId: branch.id, kind: "domain", point: domain });

    const headingBoxes: Box[] = [];
    branch.headingLines.forEach((line, index) => {
      const lineY = y - 86 + index * 18;
      const rect = rectFor(line, textX, lineY, anchor, HEADING_SIZE);
      headingBoxes.push(rect);
      labels.push({
        id: `heading-${branch.id}-${index}`,
        text: line,
        x: textX,
        y: lineY,
        anchor,
        size: HEADING_SIZE,
        rect,
      });
    });
    const hit = headingBoxes.reduce(
      (acc, box) => ({
        x: Math.min(acc.x, box.x),
        y: Math.min(acc.y, box.y),
        w: 0,
        h: 0,
      }),
      { x: headingBoxes[0]?.x ?? 0, y: headingBoxes[0]?.y ?? 0, w: 0, h: 0 },
    );
    const rightEdge = Math.max(...headingBoxes.map((box) => box.x + box.w));
    const bottomEdge = Math.max(...headingBoxes.map((box) => box.y + box.h));
    const visual = { x: hit.x, y: hit.y, w: rightEdge - hit.x, h: bottomEdge - hit.y };
    /* 52 viewBox units stays at least 44 CSS px when the SVG is ~944px wide at 1024. */
    const minHit = 52;
    const grow = Math.max(0, minHit - visual.h);
    hits.push({
      branchId: branch.id,
      rect: { x: visual.x, y: visual.y - grow, w: visual.w, h: visual.h + grow },
    });

    const count = branch.previewLabels.length;
    const pitch = 18;
    branch.previewLabels.forEach((label, index) => {
      const offset = (index - (count - 1) / 2) * pitch;
      const point = { x: activityX, y: y + offset };
      activityPoint.set(`${branch.id}:${label}`, point);
      nodes.push({
        id: `activity-${branch.id}-${index}`,
        branchId: branch.id,
        kind: "activity",
        label,
        point,
      });
      const rect = rectFor(label, textX, point.y, anchor, ACTIVITY_SIZE);
      labels.push({
        id: `activity-label-${branch.id}-${index}`,
        text: label,
        x: textX,
        y: point.y,
        anchor,
        size: ACTIVITY_SIZE,
        rect,
      });
      const control = { x: domain.x, y: point.y };
      const samples = quad(domain, control, point);
      curves.push({
        id: `twig-${branch.id}-${index}`,
        kind: "twig",
        d: `M ${fmt(domain.x)} ${fmt(domain.y)} Q ${fmt(control.x)} ${fmt(control.y)} ${fmt(point.x)} ${fmt(point.y)}`,
        samples,
      });
    });

    const edge = ellipseEdge(domain.x, domain.y);
    const dx = domain.x - edge.x;
    const dy = domain.y - edge.y;
    const bow = row % 2 === 0 ? 18 : -18;
    const len = Math.hypot(dx, dy) || 1;
    const c1 = {
      x: edge.x + dx * 0.35 + (-dy / len) * bow,
      y: edge.y + dy * 0.15 + (dx / len) * bow,
    };
    const c2 = { x: edge.x + dx * 0.72, y: domain.y };
    curves.push({
      id: `trunk-${branch.id}`,
      kind: "trunk",
      d: `M ${fmt(edge.x)} ${fmt(edge.y)} C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(domain.x)} ${fmt(domain.y)}`,
      samples: cubic(edge, c1, c2, domain),
    });

    const hub = { x: NUCLEUS.cx, y: 930 };
    const dropX = side === "left" ? 318 : 682;
    const cA = { x: domain.x, y: domain.y + 36 };
    const cB = { x: dropX, y: hub.y - 20 };
    curves.push({
      id: `converge-${branch.id}`,
      kind: "converge",
      d: `M ${fmt(domain.x)} ${fmt(domain.y)} C ${fmt(cA.x)} ${fmt(cA.y)} ${fmt(cB.x)} ${fmt(cB.y)} ${fmt(hub.x)} ${fmt(hub.y)}`,
      samples: cubic(domain, cA, cB, hub),
    });
  };

  left.forEach((branch, index) => placeDomain(branch, index));
  right.forEach((branch, index) => placeDomain(branch, index));

  const hub = { x: NUCLEUS.cx, y: 930 };
  const bottom = { x: NUCLEUS.cx, y: NUCLEUS.cy + NUCLEUS.ry };
  const mid = { x: NUCLEUS.cx, y: 760 };
  const low = { x: NUCLEUS.cx, y: 860 };
  curves.push({
    id: "converge-nucleus",
    kind: "converge",
    d: `M ${fmt(bottom.x)} ${fmt(bottom.y)} C ${fmt(mid.x)} ${fmt(mid.y)} ${fmt(low.x)} ${fmt(low.y)} ${fmt(hub.x)} ${fmt(hub.y)}`,
    samples: cubic(bottom, mid, low, hub),
  });

  const centreLines = [
    { id: "centre-title", text: "SCHOOL REALITY", y: NUCLEUS.cy - 28, size: 13 },
    { id: "centre-line-1", text: "One living institution.", y: NUCLEUS.cy - 8, size: 13 },
    { id: "centre-line-2", text: "Thousands of connected", y: NUCLEUS.cy + 10, size: 13 },
    { id: "centre-line-3", text: "activities.", y: NUCLEUS.cy + 28, size: 13 },
  ];
  for (const line of centreLines) {
    labels.push({
      id: line.id,
      text: line.text,
      x: NUCLEUS.cx,
      y: line.y,
      anchor: "middle",
      size: line.size,
      rect: rectFor(line.text, NUCLEUS.cx, line.y, "middle", line.size),
    });
  }

  SCHOOL_REALITY_PATHS.forEach((path, pathIndex) => {
    const points = path.anchors.map((anchor) => {
      const point = activityPoint.get(`${anchor.branchId}:${anchor.label}`);
      if (!point) throw new Error(`Missing activity node ${anchor.branchId}:${anchor.label}`);
      return point;
    });
    const lane = LANE_Y[pathIndex % LANE_Y.length] ?? 820;
    let d = `M ${fmt(points[0]?.x ?? 0)} ${fmt(points[0]?.y ?? 0)}`;
    const samples: Point[] = points[0] ? [points[0]] : [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (!a || !b) continue;
      const same = a.x < NUCLEUS.cx === b.x < NUCLEUS.cx;
      if (same) {
        const bow = a.x < NUCLEUS.cx ? 36 : -36;
        const control = { x: (a.x + b.x) / 2 + bow, y: (a.y + b.y) / 2 };
        d += ` Q ${fmt(control.x)} ${fmt(control.y)} ${fmt(b.x)} ${fmt(b.y)}`;
        samples.push(...quad(a, control, b).slice(1));
      } else {
        const x1 = a.x < NUCLEUS.cx ? 340 : 660;
        const x2 = b.x < NUCLEUS.cx ? 340 : 660;
        const mid = { x: (x1 + x2) / 2, y: lane };
        const c1 = { x: x1, y: a.y };
        const c2 = { x: x1, y: lane };
        const c3 = { x: x2, y: lane };
        const c4 = { x: x2, y: b.y };
        d += ` C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(mid.x)} ${fmt(mid.y)}`;
        d += ` C ${fmt(c3.x)} ${fmt(c3.y)} ${fmt(c4.x)} ${fmt(c4.y)} ${fmt(b.x)} ${fmt(b.y)}`;
        samples.push(...cubic(a, c1, c2, mid).slice(1), ...cubic(mid, c3, c4, b).slice(1));
      }
    }
    curves.push({ id: `arc-${path.id}`, kind: "arc", pathId: path.id, d, samples });
  });

  const obstacles = labels.map((label) => inflate(label.rect, 3));
  const clearOfLabels = curves.every((curve) =>
    curve.samples.every((point) => obstacles.every((box) => !contains(box, point))),
  );

  return {
    width: WIDTH,
    height: HEIGHT,
    nucleus: NUCLEUS,
    labels,
    nodes,
    curves,
    hits,
    clearOfLabels,
  };
}

export function labelOverlaps(layout: OrganismLayout = organismLayout()): string[] {
  const hits: string[] = [];
  const labels = layout.labels;
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i];
      const b = labels[j];
      if (!a || !b) continue;
      if (boxesOverlap(a.rect, b.rect)) hits.push(`${a.text} ∩ ${b.text}`);
    }
  }
  return hits;
}

export function strokeHits(layout: OrganismLayout = organismLayout()): string[] {
  const obstacles = layout.labels.map((label) => ({
    text: label.text,
    box: inflate(label.rect, 2),
  }));
  const hits: string[] = [];
  for (const curve of layout.curves) {
    for (const point of curve.samples) {
      for (const obstacle of obstacles) {
        if (contains(obstacle.box, point)) hits.push(`${curve.id} through ${obstacle.text}`);
      }
    }
  }
  return hits;
}

export const ORGANISM_VIEWBOX = { width: WIDTH, height: HEIGHT };
