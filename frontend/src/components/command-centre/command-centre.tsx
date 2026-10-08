import { useState, type ReactNode } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Landmark,
  Rocket,
  ShieldCheck,
  Users,
  AlertCircle,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createSecurityPolicy } from "@/lib/security-policy";
import { createOrganizationOnboarding } from "@/lib/onboarding/onboarding-flow";
import {
  PHASE_CATALOG,
  PHASE_LAYERS,
  PHASES_TOTAL,
  type PhaseCatalogEntry,
} from "@/lib/phase-catalog";
import { phaseContractGovernance } from "@/lib/kernel/phase-contracts";
import { scholarVerticalBindingSummary } from "@/lib/runtime/scholar-vertical-bindings";
import { generateExperience } from "@/lib/scholar/experience/experience-engine";
import { governExperience } from "@/lib/scholar/experience/experience-governance";
import { realityForOrgType } from "@/lib/scholar/experience/experience-presets";
import { featureCodesForReality } from "@/lib/scholar/capability-codes";
import { contributionIndexForCodes } from "@/lib/scholar/dashboards/grid-engine";
import type { TenantId } from "@/lib/tenant-core";

const DEMO_TENANT = "tenant:coregrid-demo" as TenantId;
const DEMO_AUTHOR = "user:demo-administrator";
const NOW = new Date().toISOString();

/** Organization classes are DATA — any CoreGrid organization type may provision. */
const ORG_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "school", label: "School (education runtime)" },
  { value: "university", label: "University / higher education" },
  { value: "company", label: "Company / enterprise" },
  { value: "government_agency", label: "Government agency" },
  { value: "community_institution", label: "Community institution" },
  { value: "non_profit", label: "Non-profit" },
  { value: "network", label: "Network / group" },
];

/** Role CODES are data; authorization resolves in P08. No fixed portal roles. */
const ORGANIZATION_ROLE_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "org_administrator", label: "Organization administrator" },
  { code: "hr_officer", label: "HR officer" },
  { code: "finance_officer", label: "Finance officer" },
  { code: "operations_officer", label: "Operations officer" },
  { code: "educator", label: "Educator" },
  { code: "learner", label: "Learner" },
  { code: "guardian", label: "Guardian" },
  { code: "member_auditor", label: "Auditor" },
  { code: "member_viewer", label: "Read-only member" },
];

type Step = "organization" | "roles" | "policies" | "launch";

interface CreatedOrganization {
  id: string;
  name: string;
  type: string;
  country: string;
  currency: string;
}
interface CreatedRole {
  code: string;
  label: string;
}
interface CreatedPolicy {
  name: string;
  environment: string;
  ruleCount: number;
}

const STEP_LABELS: Record<Step, { title: string; subtitle: string }> = {
  organization: {
    title: "1 · Create Organization",
    subtitle:
      "Provision a tenant organization through the Phase 25 onboarding pipeline (domain-free).",
  },
  roles: {
    title: "2 · Create Roles",
    subtitle: "Define the organization's role model (role codes are data; P08 authorizes).",
  },
  policies: {
    title: "3 · Create Policies",
    subtitle: "Attach governed security policies (Phase 08 security engine).",
  },
  launch: {
    title: "4 · Launch",
    subtitle: "Review the provisioned runtime and enter the workspace.",
  },
};

export function CommandCentre() {
  const [step, setStep] = useState<Step>("organization");
  const [error, setError] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<CreatedOrganization[]>([]);
  const [roles, setRoles] = useState<CreatedRole[]>([]);
  const [policies, setPolicies] = useState<CreatedPolicy[]>([]);

  const [orgForm, setOrgForm] = useState({
    legalName: "",
    orgType: "school",
    country: "Nigeria",
    currency: "NGN",
    officialEmailDomain: "",
    region: "",
    stateProvince: "",
    lga: "",
  });

  const createOrganization = () => {
    setError(null);
    if (!orgForm.legalName.trim()) {
      setError("A legal name is required to provision an organization.");
      return;
    }
    const onboarding = createOrganizationOnboarding({
      onboardingId: `onb-org-${Date.now()}`,
      organizationId: `org-${Date.now()}`,
      orgType: orgForm.orgType,
      actor: DEMO_AUTHOR,
      createdAt: NOW,
    });
    if (!onboarding.ok) {
      setError(onboarding.issues[0] ?? "Organization validation failed.");
      return;
    }
    setOrganizations((prev) => [
      ...prev,
      {
        id: onboarding.onboarding.organizationId,
        name: orgForm.legalName.trim(),
        type: onboarding.onboarding.orgType,
        country: orgForm.country,
        currency: orgForm.currency,
      },
    ]);
    setOrgForm((f) => ({
      ...f,
      legalName: "",
      officialEmailDomain: "",
      region: "",
      stateProvince: "",
      lga: "",
    }));
    setStep("roles");
  };

  const toggleRole = (code: string) => {
    const option = ORGANIZATION_ROLE_OPTIONS.find((o) => o.code === code);
    if (!option) return;
    setRoles((prev) =>
      prev.some((r) => r.code === code)
        ? prev.filter((r) => r.code !== code)
        : [...prev, { code, label: option.label }],
    );
  };

  const [policyForm, setPolicyForm] = useState({
    name: "",
    environment: "development" as "production" | "staging" | "test" | "development",
    ruleKey: "",
    effect: "allow" as "allow" | "deny",
  });

  const createPolicy = () => {
    setError(null);
    const result = createSecurityPolicy({
      name: policyForm.name,
      tenantId: DEMO_TENANT,
      environment: policyForm.environment,
      rules: { [policyForm.ruleKey]: policyForm.effect === "allow" },
      authorId: DEMO_AUTHOR,
      now: NOW,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPolicies((prev) => [
      ...prev,
      {
        name: result.policy.name,
        environment: policyForm.environment,
        ruleCount: Object.keys(result.policy.rules).length,
      },
    ]);
    setPolicyForm((f) => ({ ...f, name: "", ruleKey: "" }));
    if (step === "policies") setStep("launch");
  };

  const resetWorkspace = () => {
    setOrganizations([]);
    setRoles([]);
    setPolicies([]);
    setError(null);
    setStep("organization");
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
              S
            </div>
            <div>
              <h1 className="font-display text-lg font-bold leading-tight">
                Sherivs Control
              </h1>
              <p className="text-xs text-muted-foreground">
                Sherivs internal operating environment · {PHASES_TOTAL} architecture phases
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {PHASE_CATALOG.filter((p) => p.status !== "architecture").length}/{PHASES_TOTAL}{" "}
              phases implemented
            </Badge>
            <Button variant="outline" size="sm" asChild>
              <a href="/auth">Sign in</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <CapabilityPanel
            step={step}
            onJump={setStep}
            organizations={organizations}
            roles={roles}
            policies={policies}
          />
          <div className="space-y-6">
            <StepperHeader step={step} />
            {error ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="size-4" />
                {error}
              </div>
            ) : null}
            {step === "organization" ? (
              <OrganizationStep form={orgForm} setForm={setOrgForm} onCreate={createOrganization} />
            ) : null}
            {step === "roles" ? (
              <RolesStep roles={roles} onToggle={toggleRole} onNext={() => setStep("policies")} />
            ) : null}
            {step === "policies" ? (
              <PoliciesStep
                form={policyForm}
                setForm={setPolicyForm}
                onCreate={createPolicy}
                onBack={() => setStep("roles")}
              />
            ) : null}
            {step === "launch" ? (
              <LaunchStep
                organizations={organizations}
                roles={roles}
                policies={policies}
                onReset={resetWorkspace}
              />
            ) : null}
            <ContractGovernanceCard />
            <RuntimeBindingCard />
            <GeneratedExperienceCard orgType={orgForm.orgType} />
            <PhaseRunway />
          </div>
        </div>
      </main>
    </div>
  );
}

function CapabilityPanel(props: {
  step: Step;
  onJump: (step: Step) => void;
  organizations: CreatedOrganization[];
  roles: CreatedRole[];
  policies: CreatedPolicy[];
}) {
  const { step, onJump, organizations, roles, policies } = props;
  const items: { key: Step; label: string; icon: typeof Building2; count: number }[] = [
    { key: "organization", label: "Organizations", icon: Landmark, count: organizations.length },
    { key: "roles", label: "Roles", icon: Users, count: roles.length },
    { key: "policies", label: "Policies", icon: ShieldCheck, count: policies.length },
  ];
  return (
    <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" />
            Workspace
          </CardTitle>
          <CardDescription className="text-xs">
            Permission-derived surface. Only capabilities you are authorized to see are exposed
            here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onJump(item.key)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                step === item.key
                  ? "bg-primary/10 font-semibold text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <span className="flex items-center gap-2">
                <item.icon className="size-4" />
                {item.label}
              </span>
              <Badge variant="secondary" className="size-5 justify-center p-0 text-xs">
                {item.count}
              </Badge>
            </button>
          ))}
          <Separator className="my-2" />
          <div className="px-3 py-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{PHASES_TOTAL}</span> architecture
            phases · <span className="font-semibold text-foreground">{PHASE_LAYERS.length}</span>{" "}
            layers · one tenant boundary
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Provisioning pipeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(["organization", "roles", "policies", "launch"] as const).map((s) => {
            const active = step === s;
            const done =
              (s === "organization" && organizations.length > 0) ||
              (s === "roles" && roles.length > 0) ||
              (s === "policies" && policies.length > 0) ||
              s === "launch";
            return (
              <div key={s} className="flex items-center gap-2">
                {done && s !== "launch" ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <ChevronRight
                    className={`size-4 ${active ? "text-primary" : "text-muted-foreground/40"}`}
                  />
                )}
                <span className={active ? "font-semibold text-primary" : "text-muted-foreground"}>
                  {STEP_LABELS[s].title.replace(/^\d+ · /, "")}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </aside>
  );
}

function StepperHeader({ step }: { step: Step }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold">{STEP_LABELS[step].title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{STEP_LABELS[step].subtitle}</p>
    </div>
  );
}

function OrganizationStep(props: {
  form: {
    legalName: string;
    orgType: string;
    country: string;
    currency: string;
    officialEmailDomain: string;
    region: string;
    stateProvince: string;
    lga: string;
  };
  setForm: (updater: (prev: typeof props.form) => typeof props.form) => void;
  onCreate: () => void;
}) {
  const { form, setForm, onCreate } = props;
  const organizationTypes = ORG_TYPE_OPTIONS;
  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-4 text-muted-foreground" />
          New organization
        </CardTitle>
        <CardDescription>
          Validated by the Phase 25 <code>createOrganizationOnboarding</code> pipeline — the same
          domain-free contracts that govern production provisioning for every Sherivs runtime.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="legalName">Legal name *</Label>
          <Input
            id="legalName"
            value={form.legalName}
            onChange={(e) => set("legalName", e.target.value)}
            placeholder="e.g. Greenfield Foundation"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Organization type *</Label>
          <Select value={form.orgType} onValueChange={(v) => set("orgType", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select organization class" />
            </SelectTrigger>
            <SelectContent>
              {organizationTypes.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="country">Country *</Label>
          <Input
            id="country"
            value={form.country}
            onChange={(e) => set("country", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency *</Label>
          <Input
            id="currency"
            value={form.currency}
            onChange={(e) => set("currency", e.target.value)}
            placeholder="NGN"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="emailDomain">Official email domain(s) *</Label>
          <Input
            id="emailDomain"
            value={form.officialEmailDomain}
            onChange={(e) => set("officialEmailDomain", e.target.value)}
            placeholder="hello@organization.example (comma-separated for multiple)"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region">Region</Label>
          <Input
            id="region"
            value={form.region}
            onChange={(e) => set("region", e.target.value)}
            placeholder="e.g. Africa / Lagos"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="state">State / Province</Label>
          <Input
            id="state"
            value={form.stateProvince}
            onChange={(e) => set("stateProvince", e.target.value)}
            placeholder="e.g. Lagos"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lga">Local Government Area</Label>
          <Input
            id="lga"
            value={form.lga}
            onChange={(e) => set("lga", e.target.value)}
            placeholder="e.g. Ikeja"
          />
        </div>
        <div className="flex items-end">
          <Button onClick={onCreate} className="w-full">
            <Building2 className="size-4" />
            Create organization
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RolesStep(props: {
  roles: CreatedRole[];
  onToggle: (code: string) => void;
  onNext: () => void;
}) {
  const { roles, onToggle, onNext } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          Role model
        </CardTitle>
        <CardDescription>
          Select the roles this organization needs. Roles are derived from the Phase 02 identity
          model and Phase 25 workforce contracts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {ORGANIZATION_ROLE_OPTIONS.map((option) => {
            const selected = roles.some((r) => r.code === option.code);
            return (
              <button
                key={option.code}
                type="button"
                onClick={() => onToggle(option.code)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  selected
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {roles.length > 0 ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <span className="font-semibold">{roles.length}</span> role(s) selected:{" "}
            {roles.map((r) => r.label).join(", ")}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No roles selected yet.</p>
        )}
        <Button onClick={onNext} disabled={roles.length === 0}>
          Continue to policies
          <ChevronRight className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function PoliciesStep(props: {
  form: {
    name: string;
    environment: "production" | "staging" | "test" | "development";
    ruleKey: string;
    effect: "allow" | "deny";
  };
  setForm: (updater: (prev: typeof props.form) => typeof props.form) => void;
  onCreate: () => void;
  onBack: () => void;
}) {
  const { form, setForm, onCreate, onBack } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Security policy
        </CardTitle>
        <CardDescription>
          Each policy is validated by Phase 08 <code>createSecurityPolicy</code> — attributed,
          environment-scoped, and rule-bearing.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="policyName">Policy name *</Label>
          <Input
            id="policyName"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. default-administrative"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Environment</Label>
          <Select
            value={form.environment}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, environment: v as typeof f.environment }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select environment" />
            </SelectTrigger>
            <SelectContent>
              {(["production", "staging", "test", "development"] as const).map((env) => (
                <SelectItem key={env} value={env}>
                  {env}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ruleKey">Rule key *</Label>
          <Input
            id="ruleKey"
            value={form.ruleKey}
            onChange={(e) => setForm((f) => ({ ...f, ruleKey: e.target.value }))}
            placeholder="e.g. students.view"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Effect</Label>
          <Select
            value={form.effect}
            onValueChange={(v) => setForm((f) => ({ ...f, effect: v as typeof f.effect }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select effect" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="allow">allow</SelectItem>
              <SelectItem value="deny">deny</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onCreate}>Add policy</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LaunchStep(props: {
  organizations: CreatedOrganization[];
  roles: CreatedRole[];
  policies: CreatedPolicy[];
  onReset: () => void;
}) {
  const { organizations, roles, policies, onReset } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4 text-emerald-500" />
          Runtime provisioned
        </CardTitle>
        <CardDescription>
          A Sherivs domain runtime has been provisioned on the platform. The organization, roles
          and policy set were validated through the phase contracts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            title="Organizations"
            icon={<Landmark className="size-4" />}
            rows={organizations.map((s) => `${s.name} · ${s.country}`)}
          />
          <SummaryCard
            title="Roles"
            icon={<Users className="size-4" />}
            rows={roles.map((r) => r.label)}
          />
          <SummaryCard
            title="Policies"
            icon={<ShieldCheck className="size-4" />}
            rows={policies.map((p) => `${p.name} (${p.environment})`)}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={onReset}>
            Provision another organization
          </Button>
          <Button asChild>
            <a href="/admin/dashboard">Enter organization workspace</a>
          </Button>
          <Button variant="ghost" asChild>
            <a href="/auth">Manage your account</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard(props: { title: string; icon: ReactNode; rows: string[] }) {
  const { title, icon, rows } = props;
  return (
    <div className="rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {rows.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {rows.map((r) => (
            <li key={r} className="truncate">
              {r}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">None</p>
      )}
    </div>
  );
}

/**
 * Engineering contract governance — kernel-owned facts for the operator surface.
 *
 * The Command Centre renders these; it never restates chain totals, and it is
 * never an authority: governance here is read-only (Phase 19 displays, Phase 08
 * authorizes).
 */
const CONTRACT_GOVERNANCE = phaseContractGovernance();
const CONTRACT_HEALTH_BY_PHASE = new Map(
  CONTRACT_GOVERNANCE.rows.map((row) => [row.id, row] as const),
);

/**
 * Installed runtime bindings — which vertical of the first domain runtime
 * realizes which kernel capability. Read from the runtime's binding map, which
 * is machine-checked against the contract chain (WAVE-K9).
 */
const SCHOLAR_BINDINGS = scholarVerticalBindingSummary();

const RUNWAY_COLUMNS: ColumnDef<PhaseCatalogEntry>[] = [
  {
    accessorKey: "phase",
    header: "Phase",
    cell: (c) => <span className="font-mono text-xs">#{String(c.getValue())}</span>,
  },
  {
    accessorKey: "name",
    header: "Capability",
    cell: (c) => <span className="font-semibold">{String(c.getValue())}</span>,
  },
  {
    accessorKey: "layer",
    header: "Layer",
    cell: (c) => {
      const v = String(c.getValue());
      const color =
        v === "Foundations"
          ? "bg-emerald-500/10 text-emerald-600"
          : v === "Intelligence"
            ? "bg-violet-500/10 text-violet-600"
            : v === "Runtime"
              ? "bg-sky-500/10 text-sky-600"
              : v === "Commerce"
                ? "bg-amber-500/10 text-amber-600"
                : v === "Universal"
                  ? "bg-indigo-500/10 text-indigo-600"
                  : v === "Civilization"
                    ? "bg-teal-500/10 text-teal-600"
                    : "bg-rose-500/10 text-rose-600";
      return (
        <Badge variant="secondary" className={`border-0 ${color}`}>
          {v}
        </Badge>
      );
    },
  },
  {
    accessorKey: "modules",
    header: "Domain modules",
    cell: (c) => (
      <span className="font-mono text-xs text-muted-foreground">
        {(c.getValue() as string[]).slice(0, 3).join(", ")}
        {(c.getValue() as string[]).length > 3 ? " …" : ""}
      </span>
    ),
  },
  {
    accessorKey: "testCount",
    header: "Tests",
    cell: (c) =>
      c.getValue() ? (
        <span className="font-mono text-xs">{String(c.getValue())}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) =>
      row.original.status === "architecture" ? (
        <Badge variant="outline" className="gap-1.5 text-amber-600 border-amber-500/40">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Architecture
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Active
        </Badge>
      ),
  },
  {
    id: "contract",
    header: "Contract",
    cell: ({ row }) => {
      const health = CONTRACT_HEALTH_BY_PHASE.get(row.original.phase);
      if (!health) {
        return <span className="text-xs text-destructive">unregistered</span>;
      }
      return (
        <span className="font-mono text-xs">
          {health.sectionsDeclared}/{health.sectionsTotal}
        </span>
      );
    },
  },
  {
    id: "autonomy",
    header: "Autonomy",
    cell: ({ row }) => {
      const health = CONTRACT_HEALTH_BY_PHASE.get(row.original.phase);
      if (!health) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <span className="font-mono text-xs text-muted-foreground">
          {health.asiTier} · L{health.autonomyLevel}
        </span>
      );
    },
  },
  {
    id: "runtime",
    header: "First runtime",
    cell: ({ row }) => {
      const health = CONTRACT_HEALTH_BY_PHASE.get(row.original.phase);
      return (
        <span className="font-mono text-xs text-muted-foreground">
          {health?.firstRuntime ?? "—"}
        </span>
      );
    },
  },
];

function ContractGovernanceCard() {
  const governance = CONTRACT_GOVERNANCE;
  const tierSummary = Object.entries(governance.byAsiTier)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => `${tier} ${count}`)
    .join(" · ");
  const layerSummary = governance.byLayer
    .map(({ layer, phases }) => `${layer} ${phases}`)
    .join(" · ");
  const facts = [
    { label: "Contracts", value: String(governance.total) },
    { label: "Sections per phase", value: String(governance.sectionsPerPhase) },
    { label: "Connected roots", value: governance.roots.join(", ") || "—" },
    { label: "Bound runtime(s)", value: governance.firstRuntimes.join(", ") || "—" },
    { label: "Autonomy tiers", value: tierSummary || "—" },
    { label: "Reserved domain seats", value: governance.neutralSeatDomains.join(", ") || "—" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Engineering contract governance
          <Badge
            variant="secondary"
            className={`border-0 ${
              governance.compliant
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-amber-500/10 text-amber-600"
            }`}
          >
            {governance.sectionsComplete}/{governance.total} contract-complete
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Read from the kernel contract registry ({governance.generatedFrom}) — never restated here.
          Every phase declares all {governance.sectionsPerPhase} engineering sections, owns its
          capability, and reserves neutral seats so no phase is runtime-only. Phase names are locked
          to the canonical phase registry (ADR 202). This panel is view-only: it displays the chain,
          it never changes authorization.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{fact.label}</p>
              <p className="mt-1 font-mono text-xs break-words">{fact.value}</p>
            </div>
          ))}
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">Layers: {layerSummary}</p>
      </CardContent>
    </Card>
  );
}

function RuntimeBindingCard() {
  const bindings = SCHOLAR_BINDINGS;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          Installed runtime bindings
          <Badge variant="secondary" className="border-0 bg-emerald-500/10 text-emerald-600">
            {bindings.boundCapabilities.length}/{bindings.consumedCapabilities.length} kernel
            capabilities bound
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          The first domain runtime ({bindings.runtime}, ledger row {bindings.registryRuntimeId})
          consuming platform capabilities through its own verticals. Consumed capabilities with no
          vertical:{" "}
          {bindings.unboundCapabilities.length === 0
            ? "none"
            : bindings.unboundCapabilities.join(", ")}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bindings.byVertical.map((entry) => (
            <div key={entry.vertical} className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-semibold">{entry.vertical}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.capabilities.length} kernel{" "}
                {entry.capabilities.length === 1 ? "capability" : "capabilities"}
              </p>
              <p className="mt-1 font-mono text-[10px] break-words text-muted-foreground">
                {entry.capabilities.join(", ")}
              </p>
            </div>
          ))}
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">
          {bindings.rows.length} bindings · {bindings.evidenceCount} evidence paths — every binding
          cites a live route or runtime module the suite verifies.
        </p>
      </CardContent>
    </Card>
  );
}

function GeneratedExperienceCard({ orgType }: { orgType: string }) {
  const reality = realityForOrgType(orgType);
  const experience = generateExperience({ reality });
  const installed = featureCodesForReality(reality);
  const widgets = contributionIndexForCodes(installed.map((entry) => entry.code));
  const governance = governExperience({
    tenantId: "tenant:provisioning-preview",
    audience: "public_visitor",
    experience,
  });
  const widgetCount = widgets.reduce((total, grid) => total + grid.widgets.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="size-4 text-muted-foreground" />
          Generated experience preview
          <Badge variant="secondary" className="border-0">
            {governance.servedSections.length} sections · {installed.length} feature codes ·{" "}
            {widgetCount} widgets
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Generated from the selected organization class ({orgType}) — nothing here is
          hand-designed. Sections exist only because that reality has them;{" "}
          {experience.requiresApproval.length} sections require human approval before publication
          and AI-authored content is never published automatically. Tenant context, exposure and
          approval are enforced by the runtime, not by this view.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {experience.publicNavigation.map((section) => (
            <span
              key={section}
              className="rounded-full border border-border bg-muted/20 px-2.5 py-1 text-[10px] font-medium"
            >
              {section}
            </span>
          ))}
        </div>
        <Separator />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold">
              Internal workspaces ({experience.internalApplication.workspaces.length})
            </p>
            <p className="mt-1 font-mono text-[10px] break-words text-muted-foreground">
              {experience.internalApplication.workspaces
                .map((entry) => entry.workspace)
                .join(", ") || "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Landing workspace: {experience.internalApplication.primary ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold">Dashboards the reality generates</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {widgets.map((grid) => (
                <li key={grid.workspace}>
                  {grid.label}: {grid.widgets.length} widgets
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Separator />
        <p className="text-[11px] text-muted-foreground">
          Installed feature codes: {installed.map((entry) => entry.code).join(", ") || "none"}
        </p>
        <Separator />
        <div className="flex flex-wrap gap-3 text-xs">
          <a className="underline" href={`/reality/${encodeURIComponent(orgType)}`}>
            Open the generated environment
          </a>
          <a className="underline" href={`/marketplace?class=${encodeURIComponent(orgType)}`}>
            Marketplace catalog for this class
          </a>
          <a
            className="underline"
            href={`/manifest.webmanifest?class=${encodeURIComponent(orgType)}`}
          >
            Served manifest
          </a>
          <a className="underline" href="/platform/org">
            Sherivs internal organization
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function PhaseRunway() {
  const table = useReactTable({
    data: PHASE_CATALOG as unknown as PhaseCatalogEntry[],
    columns: RUNWAY_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="size-4 text-muted-foreground" />
          {PHASES_TOTAL}-phase architecture runway
        </CardTitle>
        <CardDescription className="text-xs">
          The complete Sherivs build sequence — Phases 01–32 have implemented, tested domain
          contracts (with explicit measured test suites); Phases 33–51 are architecture-defined
          (documents complete, awaiting domain-contract implementation). Every phase below carries a
          complete engineering contract ({CONTRACT_GOVERNANCE.sectionsPerPhase}/
          {CONTRACT_GOVERNANCE.sectionsPerPhase} sections, column “Contract”).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
