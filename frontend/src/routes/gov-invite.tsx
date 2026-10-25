/** Officer invite acceptance (SHERIVS-B02). The invited person signs in with the invited email, then accepts. */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { rpc } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/gov-invite")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === "string" ? s.token : "" }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    return { email: data.user?.email ?? null };
  },
  component: AcceptInvite,
});

function AcceptInvite() {
  const { token } = Route.useSearch();
  const { email } = Route.useRouteContext();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      await rpc("gov_officer_invite_accept", { p_token: token });
      await navigate({ to: "/gov", replace: true });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not accept the invite"); }
    finally { setBusy(false); }
  };
  if (!email) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Government console invitation</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in (or create an account) with the official email the invitation was sent to, then open this invitation link again.</p>
        <Link to="/auth" className="mt-4 inline-block underline">Sign in</Link>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Government console invitation</h1>
      <p className="mt-2 text-sm text-muted-foreground">You are signed in as <strong>{email}</strong>. The invitation only works for the email it was sent to. After accepting, you will set up an authenticator app: the console always needs MFA.</p>
      {!token && <p className="mt-3 text-sm text-destructive">This link has no invitation code.</p>}
      {err && <p className="mt-3 text-sm text-destructive" role="alert">{err}</p>}
      <div className="mt-4 flex gap-2">
        <Button disabled={busy || !token} onClick={() => void accept()}>Accept invitation</Button>
        <Button variant="outline" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}>Use another account</Button>
      </div>
    </main>
  );
}
