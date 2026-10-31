import { useEffect, useState, type ReactNode } from "react";
import { enrollmentEligible } from "@/lib/auth/webauthn-client";
import { PasskeyEnrollmentScreen } from "./passkey-enrollment-screen";

export function PasskeyEnrollmentGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"check" | "enroll" | "ready">("check");

  useEffect(() => {
    let active = true;
    void enrollmentEligible()
      .then((eligible) => {
        if (!active) return;
        setPhase(eligible ? "enroll" : "ready");
      })
      .catch(() => {
        if (active) setPhase("ready");
      });
    return () => {
      active = false;
    };
  }, []);

  if (phase === "check") {
    return <div data-testid="passkey-enrollment-check" hidden />;
  }
  if (phase === "enroll") {
    return <PasskeyEnrollmentScreen onDone={() => setPhase("ready")} />;
  }
  return children;
}
