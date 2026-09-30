/**
 * Public privacy policy page. Reads schools.privacy_policy for the
 * tenant in scope; styled skeleton when not yet authored.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { PolicyShell, PolicySkeleton } from "@/components/public/policy-shell";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  const { school, loading } = useApp();
  if (loading) return <PolicyShell title="Privacy Policy">Loading…</PolicyShell>;
  if (!school)
    return (
      <PolicyShell title="Privacy Policy">
        <p>Open this page from a school site.</p>
        <Link to="/" className="mt-4 inline-block text-[var(--tenant-primary)] underline">
          ← Home
        </Link>
      </PolicyShell>
    );
  const body = (school as any).privacy_policy as string | null;
  return (
    <PolicyShell title="Privacy Policy" schoolName={school.name}>
      {body ? (
        <div className="whitespace-pre-wrap leading-relaxed text-slate-200">{body}</div>
      ) : (
        <PolicySkeleton
          label="PRIVACY POLICY"
          body="The school privacy policy will be published here. Administrators can add this in Settings → Policies."
        />
      )}
    </PolicyShell>
  );
}
