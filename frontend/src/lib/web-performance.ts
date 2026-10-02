import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 23 — Web Platform ───────────────────────────────
// web-performance.ts — Performance architecture, Core Web Vitals,
//                      bundle/image/font optimization, CDN, SEO
// ──────────────────────────────────────────────────────────────────────

export type CoreWebVital = "lcp" | "fid" | "cls" | "inp" | "ttfb";

export interface CoreWebVitalMetric {
  readonly name: CoreWebVital;
  readonly value: number;
  readonly rating: "good" | "needs_improvement" | "poor";
  readonly timestamp: string;
  readonly element: string | null;
}

export interface PerformanceBudget {
  readonly maxBundleSizeKB: number;
  readonly maxInitialLoadKB: number;
  readonly maxLCP: number;
  readonly maxFID: number;
  readonly maxCLS: number;
  readonly maxTTFB: number;
  readonly maxImageSizeKB: number;
  readonly maxFontSizeKB: number;
}

export interface BundleOptimization {
  readonly codeSplitting: boolean;
  readonly treeShaking: boolean;
  readonly minification: boolean;
  readonly compression: "gzip" | "brotli" | "zstd" | "none";
  readonly modulePreload: boolean;
  readonly dynamicImports: boolean;
  readonly vendorChunking: boolean;
}

export interface ImageOptimization {
  readonly lazyLoading: boolean;
  readonly responsiveImages: boolean;
  readonly webpEnabled: boolean;
  readonly avifEnabled: boolean;
  readonly quality: number;
  readonly maxWidth: number;
  readonly placeholderType: "blur" | "color" | "none";
}

export interface FontOptimization {
  readonly fontDisplay: "swap" | "block" | "fallback" | "optional";
  readonly preload: boolean;
  readonly subsetting: boolean;
  readonly variableFonts: boolean;
  readonly localFallback: boolean;
}

export interface CDNConfig {
  readonly provider: string;
  readonly regions: string[];
  readonly cacheTTL: number;
  readonly purgeAPI: string | null;
  readonly imageOptimization: boolean;
  readonly edgeFunctions: boolean;
  readonly ddosProtection: boolean;
}

export interface SEOConfig {
  readonly titleTemplate: string;
  readonly defaultDescription: string;
  readonly canonicalUrl: string;
  readonly robotsTxt: boolean;
  readonly sitemapXml: boolean;
  readonly structuredData: boolean;
  readonly openGraph: boolean;
  readonly twitterCards: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function evaluateCoreWebVital(name: CoreWebVital, value: number): CoreWebVitalMetric {
  const thresholds = {
    lcp: { good: 2500, poor: 4000 },
    fid: { good: 100, poor: 300 },
    cls: { good: 0.1, poor: 0.25 },
    inp: { good: 200, poor: 500 },
    ttfb: { good: 800, poor: 1800 },
  };
  const t = thresholds[name];
  const rating = value <= t.good ? "good" : value <= t.poor ? "needs_improvement" : "poor";
  return {
    name,
    value,
    rating: rating as "good" | "needs_improvement" | "poor",
    timestamp: timeAuthority.now().at,
    element: null,
  };
}

export function checkPerformanceBudget(
  budget: PerformanceBudget,
  actuals: Record<string, number>,
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (actuals.bundleKB > budget.maxBundleSizeKB)
    failures.push(`Bundle ${actuals.bundleKB}KB exceeds budget ${budget.maxBundleSizeKB}KB`);
  if (actuals.initialKB > budget.maxInitialLoadKB)
    failures.push(`Initial ${actuals.initialKB}KB exceeds budget ${budget.maxInitialLoadKB}KB`);
  return { pass: failures.length === 0, failures };
}

export function createSEOConfig(params: {
  titleTemplate: string;
  defaultDescription: string;
  canonicalUrl: string;
}): SEOConfig {
  return {
    titleTemplate: params.titleTemplate,
    defaultDescription: params.defaultDescription,
    canonicalUrl: params.canonicalUrl,
    robotsTxt: true,
    sitemapXml: true,
    structuredData: true,
    openGraph: true,
    twitterCards: true,
  };
}

export function createBundleOptimization(): BundleOptimization {
  return {
    codeSplitting: true,
    treeShaking: true,
    minification: true,
    compression: "brotli",
    modulePreload: true,
    dynamicImports: true,
    vendorChunking: true,
  };
}

export function createCDNConfig(params: {
  provider: string;
  regions: string[];
  cacheTTL: number;
}): CDNConfig {
  return {
    ...params,
    purgeAPI: null,
    imageOptimization: true,
    edgeFunctions: false,
    ddosProtection: true,
  };
}
