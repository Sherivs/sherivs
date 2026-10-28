import type { ReactNode } from "react";
import { Navigate, useLocation } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import {
  CONSOLE_HOME_PATH,
  consoleSignInSearch,
  currentEffectiveHostKind,
  decideHostRoute,
  isConsoleOperator,
  isConsolePath,
  type ExperienceHostKind,
} from "@/lib/experience/console-host-routing";
import { ConsoleNotAuthorised } from "./not-authorised";
import { ConsoleElsewhere } from "./not-authorised";
import { ConsoleLoadingState } from "./console-primitives";
import "./console.css";

/**
 * Console host gate.
 *
 * Index (`/`) passes `hostKind` from the SSR hostname loader so console.sherivs.com
 * does not wait on `window`. The root shell wraps every route so unsigned
 * visitors on the console host go to `/auth`, and signed-in staff reach
 * `/console` instead of leaking public pages.
 */
export function ConsoleGate({
  children,
  hostKind: hostKindProp,
}: {
  children?: ReactNode;
  hostKind?: ExperienceHostKind;
}) {
  const app = useApp();
  const location = useLocation();
  const hostKind =
    typeof window === "undefined"
      ? (hostKindProp ?? currentEffectiveHostKind())
      : currentEffectiveHostKind();
  const operator = isConsoleOperator(app);
  const needsConsoleChrome = hostKind === "internal" || isConsolePath(location.pathname);

  if (needsConsoleChrome && app.loading) {
    return <ConsoleLoadingState message="Signing you in to the Internal Console…" />;
  }

  const decision = decideHostRoute({
    hostKind,
    pathname: location.pathname,
    signedIn: Boolean(app.authUser),
    isConsoleOperator: operator,
  });

  if (decision.kind === "redirect") {
    if (decision.to === "/auth") {
      return <Navigate to="/auth" search={consoleSignInSearch(location.pathname) as never} />;
    }
    return <Navigate to={decision.to as never} />;
  }
  if (decision.kind === "not_authorised") return <ConsoleNotAuthorised />;
  if (decision.kind === "console_elsewhere") return <ConsoleElsewhere />;
  if (hostKind === "internal" && location.pathname === "/") {
    return <Navigate to={CONSOLE_HOME_PATH as never} />;
  }
  return children ?? <Navigate to={CONSOLE_HOME_PATH as never} />;
}
