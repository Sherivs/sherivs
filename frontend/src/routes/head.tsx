/**
 * Institution head console (SHERIVS-B01) — served on console.<inst>.sherivs.com.
 * Same Sherivs account as the app; entry needs an active head role in this institution
 * and step-up MFA (aal2). The database enforces both (head_console_session / _overview).
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InternalSecurityGate } from "@/components/security/internal-security-gate";
import { rpc, naira } from "@/lib/scholar/rpc";
import { HEAD_ROLE_LABELS, headConsoleSlug, rememberMfaReturn } from "@/lib/head-console/host";

export const Route = createFileRoute("/head")({ ssr: false, component: HeadConsole });

type Session = { status: "ok" | "mfa_required" | "not_a_head" | "unknown_institution" | "signed_out"; roles?: string[]; school?: { id?: string; name: string; slug?: string; logo_url?: string | null } };
type Overview = { roles: string[]; school: { name: string }; students: number; staff: number; classes: number; finance: { billed: number; paid: number } | null };

function HeadConsole() {
  const navigate = useNavigate();
  const [slug] = useState(() => (typeof window === "undefined" ? null : headConsoleSlug(window.location)));
  const session = useQuery({ queryKey: ["head-session", slug], enabled: !!slug, queryFn: () => rpc<Session>("head_console_session", { p_slug: slug }) });
  const s = session.data;
  useEffect(() => {
    if (s?.status === "signed_out") navigate({ to: "/auth", replace: true });
    if (s?.status === "mfa_required") { rememberMfaReturn(`/head${window.location.search}`); navigate({ to: "/mfa", replace: true }); }
  }, [s?.status, navigate]);
  if (!slug) return <Shell><p>This address is not an institution console. Heads open console.&lt;institution&gt;.sherivs.com.</p></Shell>;
  if (session.isLoading || !s || s.status === "signed_out" || s.status === "mfa_required") return <Shell><p className="text-muted-foreground">Checking access…</p></Shell>;
  if (s.status === "unknown_institution") return <Shell><p>No institution uses this address.</p></Shell>;
  if (s.status === "not_a_head") return (
    <Shell><p>Your account is not a head of {s.school?.name}. Use the app for your day-to-day work.</p>
      <a className="mt-3 inline-block underline" href="https://app.sherivs.com">Open the app</a></Shell>);
  return <InternalSecurityGate><HeadOverview slug={slug} /></InternalSecurityGate>;
}

function HeadOverview({ slug }: { slug: string }) {
  const ov = useQuery({ queryKey: ["head-overview", slug], queryFn: () => rpc<Overview>("head_console_overview", { p_slug: slug }) });
  const o = ov.data;
  return (
    <Shell title={o?.school.name}>
      {ov.error && <p className="text-sm text-destructive">{(ov.error as Error).message}</p>}
      {o && (<>
        <p className="text-sm text-muted-foreground">Signed in as {o.roles.map((r) => HEAD_ROLE_LABELS[r] ?? r).join(", ")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {([["Students", String(o.students)], ["Staff", String(o.staff)], ["Classes", String(o.classes)],
            ...(o.finance ? [["Fees billed", naira(o.finance.billed)], ["Fees paid", naira(o.finance.paid)]] : [])] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-2xl font-semibold">{v}</div></div>))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Approvals, results sign-off and staff establishment arrive in the next console releases. Daily work stays in the app.</p>
        <Link to="/auth" className="sr-only">Sign in</Link>
      </>)}
    </Shell>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-5xl p-6">
      <h1 className="text-xl font-semibold">{title ? `${title} — Head console` : "Head console"}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}
