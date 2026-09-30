import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, MapPin, ScanFace, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, GlassCard } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { distanceMeters, parseDeviceInfo } from "@/lib/geofence";

export const Route = createFileRoute("/_authenticated/teacher/sign-in")({
  ssr: false,
  component: TeacherSignInPage,
});

type Step = 1 | 2 | 3 | 4;
type Fix = { latitude: number; longitude: number; accuracy: number };

function TeacherSignInPage() {
  const { school, profile } = useApp();
  const navigate = useNavigate();
  const schoolId = school?.id;
  const userId = profile?.id;

  const [step, setStep] = useState<Step>(1);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [inside, setInside] = useState<boolean | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string; time?: string } | null>(
    null,
  );

  const geofence = useQuery({
    queryKey: ["school-geofence", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_geofence")
        .select("id, campus_name, latitude, longitude, radius_meters, is_active")
        .eq("school_id", schoolId!)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const biometrics = useQuery({
    queryKey: ["teacher-biometrics", schoolId, userId],
    enabled: !!schoolId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_biometrics")
        .select("id, enrollment_status, device_id, face_template_hash")
        .eq("school_id", schoolId!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const failures = useQuery({
    queryKey: ["verification-failures", schoolId, userId],
    enabled: !!schoolId && !!userId,
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("attendance_verification_log")
        .select("id")
        .eq("school_id", schoolId!)
        .eq("user_id", userId!)
        .eq("result", "failed")
        .gte("verification_time", since);
      if (error) throw error;
      return data?.length ?? 0;
    },
  });

  const locked = (failures.data ?? 0) >= 3;

  const logVerification = useCallback(
    async (result: "success" | "failed", opts: { faceVerified: boolean; reason?: string }) => {
      if (!schoolId || !userId) return;
      await supabase.from("attendance_verification_log").insert({
        school_id: schoolId,
        user_id: userId,
        verification_type: "qr_face",
        latitude: fix?.latitude ?? null,
        longitude: fix?.longitude ?? null,
        accuracy_meters: fix?.accuracy ?? null,
        within_geofence: inside ?? false,
        face_verified: opts.faceVerified,
        device_id: parseDeviceInfo().deviceId,
        result,
        failure_reason: opts.reason ?? null,
      });
    },
    [schoolId, userId, fix, inside],
  );

  const checkLocation = useCallback(() => {
    setLocError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocError("Location is not available on this device or browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const next: Fix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
        };
        setFix(next);
        const fences = geofence.data ?? [];
        if (!fences.length) {
          setInside(false);
          setDistance(null);
          setLocError(
            "No campus boundary has been configured. Ask your admin to set the geofence.",
          );
          return;
        }
        let best = Number.POSITIVE_INFINITY;
        let ok = false;
        for (const f of fences) {
          const d = distanceMeters(
            next.latitude,
            next.longitude,
            Number(f.latitude),
            Number(f.longitude),
          );
          if (d < best) best = d;
          if (d <= (f.radius_meters ?? 150)) ok = true;
        }
        setDistance(Math.round(best));
        setInside(ok);
        if (ok) setStep(2);
      },
      (err) => {
        setLocating(false);
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable location access to sign in."
            : "Could not determine your location. Try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [geofence.data]);

  // Auto-run the location check once the geofence data is loaded.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || geofence.isLoading || locked) return;
    autoRan.current = true;
    checkLocation();
  }, [geofence.isLoading, checkLocation, locked]);

  const record = useMutation({
    mutationFn: async () => {
      if (!schoolId || !userId) throw new Error("Missing school context");
      const { error } = await supabase.from("attendance_logs").insert({
        school_id: schoolId,
        teacher_id: userId,
        type: "sign_in",
        timestamp: new Date().toISOString(),
        gps_latitude: fix?.latitude ?? null,
        gps_longitude: fix?.longitude ?? null,
        inside_geofence: inside ?? false,
        face_matched: true,
        verified: true,
      });
      if (error) throw error;
      await logVerification("success", { faceVerified: true });
      await supabase
        .from("teacher_biometrics")
        .update({ last_verified_at: new Date().toISOString() })
        .eq("school_id", schoolId)
        .eq("user_id", userId);
      return new Date();
    },
    onSuccess: (when) => {
      toast.success("Attendance recorded");
      setOutcome({
        ok: true,
        message: `Good morning, ${profile?.full_name ?? "there"}.`,
        time: when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
      setStep(4);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not record attendance");
      setOutcome({ ok: false, message: "We couldn't record your attendance. Please try again." });
      setStep(4);
    },
  });

  // Step 3 — simulated face scan.
  useEffect(() => {
    if (step !== 3) return;
    setScanProgress(0);
    const start = Date.now();
    const id = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / 2000) * 100);
      setScanProgress(p);
      if (p >= 100) {
        window.clearInterval(id);
        if (biometrics.data?.enrollment_status !== "enrolled") {
          toast.error("Biometrics not enrolled yet");
          void navigate({ to: "/teacher/biometric-enrollment" });
          return;
        }
        // Compare the scan against the enrolled face template for this device.
        const scannedHash = `sim_${parseDeviceInfo().deviceId.slice(0, 8)}`;
        const enrolledHash = biometrics.data?.face_template_hash;
        if (enrolledHash && enrolledHash !== scannedHash) {
          toast.error("Face verification did not match your enrolled template");
          void onFail("face_template_mismatch");
          return;
        }
        record.mutate();
      }
    }, 60);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, biometrics.data?.enrollment_status]);

  // Auto redirect after success.
  useEffect(() => {
    if (step !== 4 || !outcome?.ok) return;
    const t = window.setTimeout(() => void navigate({ to: "/teacher/dashboard" }), 3000);
    return () => window.clearTimeout(t);
  }, [step, outcome?.ok, navigate]);

  const onFail = async (reason: string) => {
    await logVerification("failed", { faceVerified: false, reason });
    void failures.refetch();
    setOutcome({ ok: false, message: "Please ensure you are inside school premises." });
    setStep(4);
  };

  return (
    <PortalPage title="Attendance sign-in" subtitle="Location and identity verification">
      <Stepper step={step} />

      {locked && (
        <GlassCard className="p-6 text-center">
          <ShieldAlert className="mx-auto size-10 text-[color:var(--danger,#f43f5e)]" />
          <h2 className="mt-3 font-display text-lg font-semibold">Account temporarily locked</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            Too many failed verification attempts — contact your school admin.
          </p>
        </GlassCard>
      )}

      {!locked && step === 1 && (
        <GlassCard className="p-6 text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-[color:var(--tenant-primary,#0d9488)]/15">
            <MapPin className="size-9 animate-pulse text-[color:var(--tenant-primary,#0d9488)]" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold">Verifying Your Location</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            Please ensure you are inside the school premises
          </p>

          {geofence.isLoading ? (
            <Skeleton className="mx-auto mt-5 h-10 w-56" />
          ) : (
            <div className="mt-5 space-y-3">
              {fix && (
                <p className="text-xs text-[color:var(--text-secondary)]">
                  Location accuracy: ±{Math.round(fix.accuracy)}m
                  {distance !== null && <> · {distance}m from campus centre</>}
                </p>
              )}
              {locating && (
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Checking your location…
                </p>
              )}
              {(locError || inside === false) && (
                <div className="mx-auto max-w-md rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
                  {locError ?? "You appear to be outside school premises."}
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={checkLocation} disabled={locating}>
                  {locating ? "Locating…" : "Retry location check"}
                </Button>
                {inside === false && (
                  <Button variant="outline" onClick={() => void onFail("outside_geofence")}>
                    Report failure
                  </Button>
                )}
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {!locked && step === 2 && (
        <GlassCard className="p-6 text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-[color:var(--tenant-primary,#0d9488)]/15 font-display text-2xl font-bold">
            {(profile?.full_name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold">Identity Verification</h2>
          <p className="mt-1 text-sm">{profile?.full_name}</p>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            Confirm your identity to record attendance
          </p>
          <Button className="mt-5" onClick={() => setStep(3)}>
            Confirm &amp; Record Attendance
          </Button>
        </GlassCard>
      )}

      {!locked && step === 3 && (
        <GlassCard className="p-6 text-center">
          <h2 className="font-display text-lg font-semibold">Face Verification</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            Hold your face in front of the camera
          </p>
          <ScanBox />
          <div className="mx-auto mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[color:var(--tenant-primary,#0d9488)] transition-[width] duration-100"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[color:var(--text-secondary)]">
            {Math.round(scanProgress)}%
          </p>
        </GlassCard>
      )}

      {step === 4 && outcome && (
        <GlassCard className="p-8 text-center">
          {outcome.ok ? (
            <>
              <CheckCircle2 className="mx-auto size-14 text-emerald-400" />
              <h2 className="mt-3 font-display text-xl font-bold">Attendance Recorded ✓</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                {outcome.message} Signed in at {outcome.time}
              </p>
              <p className="mt-3 text-xs text-[color:var(--text-secondary)]">
                Redirecting to your dashboard…
              </p>
            </>
          ) : (
            <>
              <XCircle className="mx-auto size-14 text-rose-400" />
              <h2 className="mt-3 font-display text-xl font-bold">Location verification failed</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{outcome.message}</p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setOutcome(null);
                  setStep(1);
                  checkLocation();
                }}
              >
                Try again
              </Button>
            </>
          )}
        </GlassCard>
      )}
    </PortalPage>
  );
}

function ScanBox() {
  return (
    <div className="relative mx-auto mt-5 grid h-48 w-full max-w-sm place-items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <ScanFace className="size-14 text-white/30" />
      <div
        className="absolute inset-x-0 h-0.5 bg-[color:var(--tenant-primary,#0d9488)]/80"
        style={{ animation: "uos-scanline 2s linear infinite" }}
      />
      <style>{`@keyframes uos-scanline{0%{top:8%}100%{top:92%}}`}</style>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const labels = ["Location", "Identity", "Face", "Result"];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const done = step > n;
        const active = step === n;
        return (
          <span
            key={l}
            className={`rounded-full border px-3 py-1 ${
              active
                ? "border-[color:var(--tenant-primary,#0d9488)] text-[color:var(--tenant-primary,#0d9488)]"
                : done
                  ? "border-emerald-500/40 text-emerald-400"
                  : "border-white/10 text-[color:var(--text-secondary)]"
            }`}
          >
            {n}. {l}
          </span>
        );
      })}
    </div>
  );
}
