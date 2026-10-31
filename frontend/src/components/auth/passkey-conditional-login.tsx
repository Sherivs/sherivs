import { useEffect, useRef } from "react";
import {
  authenticateWithPasskey,
  cancelActivePasskeyCeremony,
  passkeyAutofillSupported,
} from "@/lib/auth/webauthn-client";
import { WEBAUTHN_PUBLIC_ERROR } from "@/lib/auth/webauthn-policy";

type Props = {
  enabled: boolean;
  onBusy?: (busy: boolean) => void;
  onError?: (message: string) => void;
  onSignedIn: () => Promise<void> | void;
};

/**
 * Conditional mediation (browser passkey autofill). A successful prompt is
 * still verified on the server and turned into a Supabase Auth session.
 */
export function PasskeyConditionalLogin({ enabled, onBusy, onError, onSignedIn }: Props) {
  const onBusyRef = useRef(onBusy);
  const onErrorRef = useRef(onError);
  const onSignedInRef = useRef(onSignedIn);
  onBusyRef.current = onBusy;
  onErrorRef.current = onError;
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      if (!(await passkeyAutofillSupported())) return;
      try {
        const session = await authenticateWithPasskey({ autofill: true });
        if (!active || !session) return;
        onBusyRef.current?.(true);
        await onSignedInRef.current();
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : WEBAUTHN_PUBLIC_ERROR.auth_failed;
        if (message === WEBAUTHN_PUBLIC_ERROR.cancelled) return;
        onErrorRef.current?.(message);
      } finally {
        if (active) onBusyRef.current?.(false);
      }
    })();
    return () => {
      active = false;
      cancelActivePasskeyCeremony();
    };
  }, [enabled]);

  return null;
}
