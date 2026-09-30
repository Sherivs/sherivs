/**
 * Public school rules page. Reads schools.school_rules for the
 * tenant in scope; styled skeleton when not yet authored.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { PolicyShell, PolicySkeleton } from "@/components/public/policy-shell";

export const Route = createFileRoute("/rules")({
  component: RulesPage,
});

function RulesPage() {
  const { school, loading } = useApp();
  if (loading) return <PolicyShell title="School Rules">Loading…</PolicyShell>;
  if (!school)
    return (
      <PolicyShell title="School Rules">
        <p>Open this page from a school site.</p>
        <Link to="/" className="mt-4 inline-block text-[var(--tenant-primary)] underline">
          ← Home
        </Link>
      </PolicyShell>
    );
  const body = (school as any).school_rules as string | null;
  return (
    <PolicyShell title="School Rules & Regulations" schoolName={school.name}>
      {body ? (
        <div className="whitespace-pre-wrap leading-relaxed text-slate-200">{body}</div>
      ) : (
        <PolicySkeleton
          label="SCHOOL RULES AND REGULATIONS"
          body="The school rules and regulations will be published here. Administrators can add this in Settings → Policies."
        />
      )}
    </PolicyShell>
  );
}
