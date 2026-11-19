import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { catalogItem } from "@/lib/sherivs-ws/engine";
import { shellIcon } from "@/lib/shell/icon-registry";
import { formatWidgetMetric } from "@/lib/shell/metrics";
import { homeHrefForScope } from "@/lib/shell/chrome";
import { resolveCard, type CardKind, type ScreenLoader } from "@/lib/shell/card-registry";
import { useAppShell } from "./shell-context";
import { CardNotFoundState, PlannedCapabilityState } from "./planned-capability-state";

const lazyScreens = new Map<ScreenLoader, LazyExoticComponent<ComponentType>>();

function lazyScreen(loader: ScreenLoader): LazyExoticComponent<ComponentType> {
  let screen = lazyScreens.get(loader);
  if (!screen) {
    screen = lazy(loader);
    lazyScreens.set(loader, screen);
  }
  return screen;
}

function SectionLoading() {
  return (
    <section className="app-shell-section" aria-busy="true" data-testid="app-shell-section-loading">
      <p className="app-shell-empty">Loading…</p>
    </section>
  );
}

/**
 * Opens `/home/s/<key>` through the card registry (ADR-106): a live card renders its real screen
 * (loaded lazily), a planned card renders the honest planned state, and an unknown key renders a
 * not-found state.
 */
export function AppSectionScreen({ sectionKey }: { sectionKey: string }) {
  const resolution = resolveCard(sectionKey);
  if (resolution.kind === "live") {
    const Screen = lazyScreen(resolution.contract.screen);
    return (
      <Suspense fallback={<SectionLoading />}>
        <Screen />
      </Suspense>
    );
  }
  if (resolution.kind === "planned") {
    return <PlannedSection sectionKey={sectionKey} kind={resolution.contract.kind} />;
  }
  return <UnknownSection sectionKey={sectionKey} />;
}

function UnknownSection({ sectionKey }: { sectionKey: string }) {
  const shell = useAppShell();
  return (
    <CardNotFoundState
      sectionKey={sectionKey}
      homeHref={homeHrefForScope(shell.scopeFocus)}
      locale={shell.manifest?.locale}
    />
  );
}

function PlannedSection({ sectionKey, kind }: { sectionKey: string; kind: CardKind }) {
  const shell = useAppShell();
  const item =
    shell.nav.find((row) => row.key === sectionKey) ??
    shell.manifest?.widgets.find((row) => row.key === sectionKey) ??
    shell.manifest?.actions.find((row) => row.key === sectionKey) ??
    catalogItem(sectionKey);
  const rawLabel = item && "label" in item ? item.label : sectionKey;
  const label = typeof rawLabel === "string" ? rawLabel : (rawLabel?.en ?? sectionKey);
  const icon = item && "icon" in item ? item.icon : "layout";
  const data = shell.cards[sectionKey];
  const hasFigure =
    !!data && !data.unavailable && data.metric != null && String(data.metric) !== "";
  const metric = formatWidgetMetric(data);
  return (
    <PlannedCapabilityState
      label={label}
      kind={kind}
      homeHref={homeHrefForScope(shell.scopeFocus)}
      Icon={shellIcon(icon)}
      context={`${shell.roleTitle} in ${shell.orgName}`}
      figure={hasFigure ? { text: metric.text, tone: metric.tone, note: data?.note } : null}
      locale={shell.manifest?.locale}
    />
  );
}
