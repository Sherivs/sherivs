import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";

/** Public status page (SHERIVS-018). Reads the leak-free /health.json report only. */
export const Route = createFileRoute("/(site)/status")({
  component: StatusPage,
  head: () => ({ meta: [{ title: `Status — ${PLATFORM_NAME}` }] }),
});

type Report = { status: string; ts?: string; checks?: Record<string, { status: string }> | Array<{ name: string; status: string }> };

function StatusPage() {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const load = () => fetch("/health.json", { cache: "no-store" }).then((x) => x.json()).then(setR).catch(() => setErr(true));
    load(); const id = setInterval(load, 30000); return () => clearInterval(id);
  }, []);
  const checks = r?.checks ? (Array.isArray(r.checks) ? r.checks : Object.entries(r.checks).map(([name, v]) => ({ name, status: v.status }))) : [];
  const tone = (s: string) => (s === "ok" || s === "healthy" ? "text-emerald-600" : s === "degraded" ? "text-amber-600" : "text-red-600");
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold">{PLATFORM_NAME} status</h1>
      {err && <p className="mt-6 text-red-600">Status is unavailable right now.</p>}
      {r && (
        <>
          <p className={`mt-6 text-xl font-medium ${tone(r.status)}`}>Overall: {r.status}</p>
          <ul className="mt-6 divide-y rounded-md border">
            {checks.map((c) => (
              <li key={c.name} className="flex justify-between px-4 py-3"><span>{c.name}</span><span className={tone(c.status)}>{c.status}</span></li>
            ))}
          </ul>
          {r.ts && <p className="mt-4 text-sm text-muted-foreground">Checked {new Date(r.ts).toLocaleString()}</p>}
        </>
      )}
    </section>
  );
}
