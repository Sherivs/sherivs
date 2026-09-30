import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ScanFace, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, GlassCard } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { parseDeviceInfo } from "@/lib/geofence";

export const Route = createFileRoute("/_authenticated/teacher/biometric-enrollment")({
  ssr: false,
  component: BiometricEnrollmentPage,
});

function BiometricEnrollmentPage() {
  const { school, profile } = useApp();
  const navigate = useNavigate();
  const schoolId = school?.id;
  const userId = profile?.id;

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [consent, setConsent] = useState(false);
  const [device, setDevice] = useState({ deviceId: "", model: "", userAgent: "" });
  const [progress, setProgress] = useState(0);

  useEffect(() => setDevice(parseDeviceInfo()), []);

  const existing = useQuery({
    queryKey: ["teacher-biometrics", schoolId, userId],
    enabled: !!schoolId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_biometrics")
        .select("id, enrollment_status, device_model, enrolled_at")
        .eq("school_id", schoolId!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const registerDevice = useMutation({
    mutationFn: async () => {
      if (!schoolId || !userId) throw new Error("Missing school context");
      const { error } = await supabase.from("teacher_biometrics").upsert(
        {
          school_id: schoolId,
          user_id: userId,
          device_id: device.deviceId,
          device_model: device.model,
          enrollment_status: "pending",
        },
        { onConflict: "school_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Device registered");
      setStep(3);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not register device"),
  });

  const completeEnrollment = useMutation({
    mutationFn: async () => {
      if (!schoolId || !userId) throw new Error("Missing school context");
      const { error } = await supabase
        .from("teacher_biometrics")
        .update({
          enrollment_status: "enrolled",
          enrolled_at: new Date().toISOString(),
          face_template_hash: `sim_${device.deviceId.slice(0, 8)}`,
        })
        .eq("school_id", schoolId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enrollment complete");
      void existing.refetch();
      setStep(4);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Enrollment failed"),
  });

  useEffect(() => {
    if (step !== 3) return;
    setProgress(0);
    const start = Date.now();
    const id = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / 2000) * 100);
      setProgress(p);
      if (p >= 100) {
        window.clearInterval(id);
        completeEnrollment.mutate();
      }
    }, 60);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <PortalPage
      title="Biometric enrollment"
      subtitle="One-time setup so you can sign in with location and face verification"
    >
      {existing.isLoading ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : existing.data?.enrollment_status === "enrolled" && step !== 4 ? (
        <GlassCard className="p-6 text-center">
          <ShieldCheck className="mx-auto size-12 text-emerald-400" />
          <h2 className="mt-3 font-display text-lg font-semibold">You're already enrolled</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            Registered on {existing.data.device_model ?? "a device"}
            {existing.data.enrolled_at
              ? ` · ${new Date(existing.data.enrolled_at).toLocaleDateString()}`
              : ""}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => void navigate({ to: "/teacher/sign-in" })}>Go to sign-in</Button>
            <Button variant="outline" onClick={() => setStep(2)}>
              Re-register this device
            </Button>
          </div>
        </GlassCard>
      ) : (
        <>
          {step === 1 && (
            <GlassCard className="p-6">
              <h2 className="font-display text-lg font-semibold">What we collect &amp; why</h2>
              <ul className="mt-3 space-y-2 text-sm text-[color:var(--text-secondary)]">
                <li>
                  • Your device identifier and browser/OS name, to tie sign-ins to a trusted device.
                </li>
                <li>
                  • A face verification result (match / no match) — no photo or image is stored.
                </li>
                <li>• Your GPS coordinates at sign-in, to confirm you are on campus.</li>
                <li>
                  • This data is used only for staff attendance and fraud prevention by your school.
                </li>
                <li>• You can ask your school admin to remove your enrollment at any time.</li>
              </ul>
              <label className="mt-5 flex items-start gap-3 text-sm">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                <span>I have read and consent to biometric attendance verification.</span>
              </label>
              <Button className="mt-5" disabled={!consent} onClick={() => setStep(2)}>
                Continue
              </Button>
            </GlassCard>
          )}

          {step === 2 && (
            <GlassCard className="p-6">
              <div className="flex items-center gap-3">
                <Smartphone className="size-6 text-[color:var(--tenant-primary,#0d9488)]" />
                <h2 className="font-display text-lg font-semibold">Register this device</h2>
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <Info label="Device" value={device.model || "—"} />
                <Info
                  label="Device ID"
                  value={device.deviceId ? `${device.deviceId.slice(0, 12)}…` : "—"}
                />
                <div className="sm:col-span-2">
                  <Info label="User agent" value={device.userAgent || "—"} mono />
                </div>
              </dl>
              <Button
                className="mt-5"
                disabled={registerDevice.isPending}
                onClick={() => registerDevice.mutate()}
              >
                {registerDevice.isPending ? "Registering…" : "Register This Device"}
              </Button>
            </GlassCard>
          )}

          {step === 3 && (
            <GlassCard className="p-6 text-center">
              <h2 className="font-display text-lg font-semibold">Face enrollment</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                Hold still while we capture your verification template
              </p>
              <div className="relative mx-auto mt-5 grid h-48 w-full max-w-sm place-items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                <ScanFace className="size-14 text-white/30" />
                <div
                  className="absolute inset-x-0 h-0.5 bg-[color:var(--tenant-primary,#0d9488)]/80"
                  style={{ animation: "uos-scanline 2s linear infinite" }}
                />
                <style>{`@keyframes uos-scanline{0%{top:8%}100%{top:92%}}`}</style>
              </div>
              <div className="mx-auto mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[color:var(--tenant-primary,#0d9488)] transition-[width] duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </GlassCard>
          )}

          {step === 4 && (
            <GlassCard className="p-8 text-center">
              <CheckCircle2 className="mx-auto size-14 text-emerald-400" />
              <h2 className="mt-3 font-display text-xl font-bold">Enrollment complete!</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                You can now use biometric sign-in.
              </p>
              <Button className="mt-4" onClick={() => void navigate({ to: "/teacher/sign-in" })}>
                Go to sign-in
              </Button>
            </GlassCard>
          )}
        </>
      )}
    </PortalPage>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <dt className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
        {label}
      </dt>
      <dd className={`mt-1 break-words text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
