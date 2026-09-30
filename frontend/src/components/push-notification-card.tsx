import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, BellOff, Send } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { GlassCard } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { getPushSupport, registerPushToken, unregisterPushToken } from "@/lib/push-client";
import { sendTestPush } from "@/lib/push.functions";

/** Lets any signed-in user turn device push notifications on or off. */
export function PushNotificationCard() {
  const { profile } = useApp();
  const userId = profile?.id;
  const [support, setSupport] = useState(() => ({
    supported: false,
    permission: "default" as string,
  }));
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const s = getPushSupport();
    setSupport({ supported: s.supported, permission: String(s.permission) });
    setEnabled(!!profile?.push_token && s.permission === "granted");
  }, [profile?.push_token]);

  const enable = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("You need to be signed in");
      const token = await registerPushToken(userId);
      if (!token) throw new Error("Notification permission was not granted");
      return token;
    },
    onSuccess: () => {
      setEnabled(true);
      setSupport((s) => ({ ...s, permission: "granted" }));
      toast.success("Push notifications enabled on this device");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not enable push notifications"),
  });

  const disable = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("You need to be signed in");
      await unregisterPushToken(userId);
    },
    onSuccess: () => {
      setEnabled(false);
      toast.success("Push notifications turned off");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not turn off push notifications"),
  });

  const testFn = useServerFn(sendTestPush);
  const test = useMutation({
    mutationFn: async () => testFn({ data: undefined as never }),
    onSuccess: (res) => {
      if (res?.skipped === "vapid_keys_missing") {
        toast.error("Push delivery keys are not configured yet — ask your administrator.");
        return;
      }
      if (!res?.delivered) {
        toast.error("No device received the test notification.");
        return;
      }
      toast.success("Test notification sent to your device");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not send a test notification"),
  });

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            {enabled ? <BellRing className="size-5" /> : <BellOff className="size-5" />}
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold">Device push notifications</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {!support.supported
                ? "This browser does not support push notifications."
                : support.permission === "denied"
                  ? "Notifications are blocked in your browser settings. Allow them, then try again."
                  : enabled
                    ? "You will get alerts on this device even when the portal is closed."
                    : "Turn on alerts for announcements, grades, fees and messages."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => test.mutate()}
                disabled={test.isPending}
              >
                <Send className="mr-1.5 size-3.5" />
                {test.isPending ? "Sending…" : "Send test"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => disable.mutate()}
                disabled={disable.isPending}
              >
                Turn off
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => enable.mutate()}
              disabled={!support.supported || support.permission === "denied" || enable.isPending}
            >
              {enable.isPending ? "Enabling…" : "Enable notifications"}
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default PushNotificationCard;
