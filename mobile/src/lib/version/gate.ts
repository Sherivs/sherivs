import * as Application from "expo-application";
import { AppState, Platform } from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { mobileEnv } from "@/lib/app-runtime";
import {
  decideVersionGate,
  fetchMobileVersionConfig,
  type VersionGateDecision,
} from "@/lib/version/core";

export function useVersionGate() {
  const [decision, setDecision] = useState<VersionGateDecision>({ kind: "none" });
  const [dismissedLatest, setDismissedLatest] = useState<string | null>(null);

  const platform = Platform.OS === "ios" ? "ios" : "android";

  const refresh = useCallback(async () => {
    const config = await fetchMobileVersionConfig({
      baseUrl: mobileEnv.sherivsWebBaseUrl,
      platform,
    });
    if (!config) {
      setDecision({ kind: "none" });
      setDismissedLatest(null);
      return;
    }

    const next = decideVersionGate(Application.nativeApplicationVersion ?? null, config);
    setDecision(next);
    if (next.kind !== "soft") setDismissedLatest(null);
  }, [platform]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const showSoftBanner = useMemo(() => {
    return decision.kind === "soft" && decision.latest !== dismissedLatest;
  }, [decision, dismissedLatest]);

  return {
    decision,
    showSoftBanner,
    dismissSoftBanner: () => {
      if (decision.kind === "soft") setDismissedLatest(decision.latest);
    },
  };
}
