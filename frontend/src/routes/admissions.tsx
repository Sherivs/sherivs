/**
 * Public multi-step admissions form. No auth required.
 * Anonymous INSERT into admission_applications + storage uploads.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveTenantSlug } from "@/lib/tenant";

type SearchParams = { school?: string };

export const Route = createFileRoute("/admissions")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    school: typeof s.school === "string" ? s.school : undefined,
  }),
  component: AdmissionsPage,
  head: () => ({
    meta: [
      { title: "Admissions — Apply Online" },
      {
        name: "description",
        content: "Complete the online admissions application form.",
      },
    ],
  }),
});

type School = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  admission_requirements: string | null;
  admission_deadline: string | null;
};

type ClassRow = { id: string; name: string };

const INTERVIEW_QUESTIONS = [
  {
    id: "q1",
    category: "Personal Development",
    question: "Tell us about yourself and what makes you unique as a student.",
    hint: "There are no right or wrong answers. Be yourself.",
  },
  {
    id: "q2",
    category: "Academic Motivation",
    question: "Why do you want to study at our school specifically?",
    hint: "Be specific about what attracted you to our institution.",
  },
  {
    id: "q3",
    category: "Academic Strengths",
    question: "What are your strongest academic subjects and why?",
    hint: "Give examples of achievements in these areas.",
  },
  {
    id: "q4",
    category: "Areas for Growth",
    question: "Which subjects do you find challenging and how do you work to improve?",
    hint: "Show self-awareness and a growth mindset.",
  },
  {
    id: "q5",
    category: "Extracurricular",
    question: "What activities, sports, or clubs are you involved in outside school?",
    hint: "Leadership roles are particularly valued.",
  },
  {
    id: "q6",
    category: "Character",
    question: "Describe a time you showed leadership or helped someone in need.",
    hint: "Be specific. Give a real example.",
  },
  {
    id: "q7",
    category: "Future Goals",
    question: "What career or university path are you considering and why?",
    hint: "Be honest. Having a clear goal is a positive indicator.",
  },
  {
    id: "q8",
    category: "Values",
    question: "What does integrity mean to you? Give an example from your own life.",
    hint: "Elite schools value character as much as academics.",
  },
  {
    id: "q9",
    category: "School Fit",
    question: "How do you plan to contribute to our school community?",
    hint: "Think about clubs, sports, academics, or community service.",
  },
  {
    id: "q10",
    category: "Family Support",
    question: "How does your family support your education at home?",
    hint: "For parents: how do you support your child's studies?",
  },
];

const STEPS = [
  "Personal Info",
  "Academic History",
  "Family Details",
  "Documents",
  "Review & Submit",
] as const;

type FormState = {
  // step 1
  first_name: string;
  last_name: string;
  dob: string;
  gender: string;
  nationality: string;
  religion: string;
  blood_group: string;
  genotype: string;
  applying_for_class: string;
  academic_year: string;
  address: string;
  medical_conditions: string;
  has_special_needs: boolean;
  special_needs_detail: string;
  has_allergies: boolean;
  allergies_detail: string;
  // step 2
  previous_school: string;
  previous_school_address: string;
  previous_class: string;
  year_completed: string;
  reason_for_leaving: string;
  achievements: string;
  was_disciplined: boolean;
  discipline_explanation: string;
  // step 3
  p1_name: string;
  p1_relationship: string;
  p1_phone: string;
  p1_email: string;
  p1_occupation: string;
  p1_address: string;
  add_parent_two: boolean;
  p2_name: string;
  p2_relationship: string;
  p2_phone: string;
  p2_email: string;
  p2_occupation: string;
  p2_address: string;
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  // step 4
  docs: Record<string, { url: string; name: string }>;
  // step 5
  declaration_ok: boolean;
  privacy_ok: boolean;
};

const INITIAL_FORM: FormState = {
  first_name: "",
  last_name: "",
  dob: "",
  gender: "",
  nationality: "Nigerian",
  religion: "",
  blood_group: "",
  genotype: "",
  applying_for_class: "",
  academic_year: `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`,
  address: "",
  medical_conditions: "",
  has_special_needs: false,
  special_needs_detail: "",
  has_allergies: false,
  allergies_detail: "",
  previous_school: "",
  previous_school_address: "",
  previous_class: "",
  year_completed: "",
  reason_for_leaving: "",
  achievements: "",
  was_disciplined: false,
  discipline_explanation: "",
  p1_name: "",
  p1_relationship: "",
  p1_phone: "",
  p1_email: "",
  p1_occupation: "",
  p1_address: "",
  add_parent_two: false,
  p2_name: "",
  p2_relationship: "",
  p2_phone: "",
  p2_email: "",
  p2_occupation: "",
  p2_address: "",
  emergency_name: "",
  emergency_relationship: "",
  emergency_phone: "",
  docs: {},
  declaration_ok: false,
  privacy_ok: false,
};

type DocSpec = { key: string; label: string; accept: string; maxMb: number; optional?: boolean };
const REQUIRED_DOCS: DocSpec[] = [
  { key: "passport", label: "Passport Photograph", accept: "image/*", maxMb: 2 },
  { key: "birth_cert", label: "Birth Certificate", accept: "image/*,application/pdf", maxMb: 5 },
  {
    key: "report_card",
    label: "Last Term Report Card",
    accept: "image/*,application/pdf",
    maxMb: 5,
  },
  {
    key: "transfer_cert",
    label: "Transfer Certificate (if applicable)",
    accept: "image/*,application/pdf",
    maxMb: 5,
    optional: true,
  },
];

/* ------------------------------------------------------------------ */

function AdmissionsPage() {
  const search = useSearch({ from: "/admissions" });
  const slug = search.school ?? resolveTenantSlug();

  const schoolQ = useQuery({
    queryKey: ["adm-school", slug],
    enabled: !!slug,
    queryFn: async (): Promise<School | null> => {
      const { data } = await supabase
        .from("schools")
        .select(
          "id, name, slug, logo_url, primary_color, admission_requirements, admission_deadline",
        )
        .eq("slug", slug as string)
        .eq("is_active", true)
        .maybeSingle();
      return (data as School | null) ?? null;
    },
  });
  const school = schoolQ.data ?? null;

  // Set tenant color
  useEffect(() => {
    if (school?.primary_color) {
      document.documentElement.style.setProperty("--tenant-primary", school.primary_color);
    }
  }, [school?.primary_color]);

  const classesQ = useQuery({
    queryKey: ["adm-classes", school?.id],
    enabled: !!school?.id,
    queryFn: async (): Promise<ClassRow[]> => {
      const { data } = await supabase
        .from("classes")
        .select("id, name")
        .eq("school_id", school!.id)
        .order("name");
      return (data ?? []) as ClassRow[];
    },
  });

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; number: string } | null>(null);
  const [showInterview, setShowInterview] = useState(false);

  if (!slug) {
    return (
      <Centered title="School not specified">
        Please use a valid school link to apply.{" "}
        <Link to="/" className="underline">
          Go home
        </Link>
      </Centered>
    );
  }
  if (schoolQ.isLoading) return <Centered title="Loading…" />;
  if (!school) return <Centered title="School not found">No school matched {slug}.</Centered>;

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function validateStep(s: number): string | null {
    if (s === 1) {
      if (!form.first_name || !form.last_name) return "Please enter the student's full name.";
      if (!form.dob) return "Date of birth is required.";
      if (!form.applying_for_class) return "Please select the class applying for.";
      if (!form.academic_year) return "Academic year is required.";
      if (!form.address) return "Home address is required.";
    }
    if (s === 3) {
      if (!form.p1_name || !form.p1_relationship || !form.p1_phone || !form.p1_email)
        return "Parent/Guardian name, relationship, phone and email are required.";
      if (!form.emergency_name || !form.emergency_phone)
        return "Emergency contact name and phone are required.";
    }
    if (s === 4) {
      const missing = REQUIRED_DOCS.filter((d) => !d.optional && !form.docs[d.key]).map(
        (d) => d.label,
      );
      if (missing.length) return `Please upload: ${missing.join(", ")}.`;
    }
    if (s === 5) {
      if (!form.declaration_ok) return "Please confirm the declaration.";
      if (!form.privacy_ok) return "Please confirm you have read the privacy policy.";
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      toast.error(err);
      return;
    }
    setStep((s) => Math.min(5, s + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitApplication() {
    const err = validateStep(5);
    if (err) {
      toast.error(err);
      return;
    }
    if (!school) return;
    setSubmitting(true);
    try {
      const appNumber = `${school.slug.toUpperCase()}${new Date().getFullYear()}${Math.floor(
        Math.random() * 9000 + 1000,
      )}`;
      const payload = {
        school_id: school.id,
        application_number: appNumber,
        student_first_name: form.first_name,
        student_last_name: form.last_name,
        student_date_of_birth: form.dob,
        student_gender: form.gender || null,
        student_nationality: form.nationality || null,
        student_religion: form.religion || null,
        student_blood_group: form.blood_group || null,
        student_genotype: form.genotype || null,
        student_address: form.address || null,
        applying_for_class: form.applying_for_class,
        academic_year_applying: form.academic_year,
        previous_school_name: form.previous_school || null,
        previous_school_address: form.previous_school_address || null,
        previous_class_completed: form.previous_class || null,
        year_completed: form.year_completed || null,
        reason_for_leaving: form.reason_for_leaving || null,
        academic_achievements: form.achievements || null,
        was_disciplined: form.was_disciplined,
        discipline_explanation: form.discipline_explanation || null,
        parent_one_name: form.p1_name,
        parent_one_relationship: form.p1_relationship,
        parent_one_phone: form.p1_phone,
        parent_one_email: form.p1_email,
        parent_one_occupation: form.p1_occupation || null,
        parent_one_address: form.p1_address || null,
        parent_two_name: form.add_parent_two ? form.p2_name || null : null,
        parent_two_relationship: form.add_parent_two ? form.p2_relationship || null : null,
        parent_two_phone: form.add_parent_two ? form.p2_phone || null : null,
        parent_two_email: form.add_parent_two ? form.p2_email || null : null,
        parent_two_occupation: form.add_parent_two ? form.p2_occupation || null : null,
        parent_two_address: form.add_parent_two ? form.p2_address || null : null,
        emergency_contact_name: form.emergency_name,
        emergency_contact_relationship: form.emergency_relationship || null,
        emergency_contact_phone: form.emergency_phone,
        medical_conditions: form.medical_conditions || null,
        has_special_needs: form.has_special_needs,
        disabilities_or_special_needs: form.has_special_needs
          ? form.special_needs_detail || null
          : null,
        has_allergies: form.has_allergies,
        allergies_detail: form.has_allergies ? form.allergies_detail || null : null,
        documents_uploaded: form.docs,
      };
      const { data, error } = await supabase
        .from("admission_applications")
        .insert(payload)
        .select("id, application_number")
        .single();
      if (error) throw error;
      setSubmitted({ id: data.id as string, number: data.application_number as string });
    } catch (e) {
      toast.error((e as Error).message || "Could not submit application.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <SuccessScreen
        appNumber={submitted.number}
        onInterview={() => setShowInterview(true)}
        showInterview={showInterview}
        applicationId={submitted.id}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-[#0a0f1e] text-white">
      <div className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-3">
            {school.logo_url ? (
              <img
                src={school.logo_url}
                alt=""
                width={40}
                height={40}
                loading="lazy"
                decoding="async"
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <div
                className="grid h-10 w-10 place-items-center rounded-lg font-bold"
                style={{ background: "var(--tenant-primary, #3b82f6)" }}
              >
                {school.name[0]}
              </div>
            )}
            <div>
              <div className="font-display text-lg font-semibold">{school.name}</div>
              <div className="text-xs text-white/50">Admissions {form.academic_year}</div>
            </div>
          </div>
          <Link to="/" className="text-sm text-white/60 hover:text-white">
            ← Back to website
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          Online Admission Application
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-white/60">
          {school.admission_requirements ?? "Complete the form below to apply for admission."}
        </p>
        {school.admission_deadline && (
          <p className="mt-2 text-xs uppercase tracking-widest text-amber-300">
            Application deadline: {new Date(school.admission_deadline).toDateString()}
          </p>
        )}

        {/* Stepper */}
        <div className="mt-10">
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const active = n === step;
              const done = n < step;
              return (
                <div key={label} className="flex flex-1 items-center gap-2">
                  <div
                    className={
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold transition " +
                      (done
                        ? "bg-emerald-500 text-white"
                        : active
                          ? "bg-white text-black"
                          : "border border-white/15 text-white/50")
                    }
                  >
                    {done ? <Check className="h-4 w-4" /> : n}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={"h-px flex-1 " + (done ? "bg-emerald-500" : "bg-white/10")} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between text-[10px] uppercase tracking-widest text-white/50">
            {STEPS.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        </div>

        <div className="mt-10 rounded-3xl border border-white/[0.07] bg-white/[0.03] p-6 md:p-8">
          {step === 1 && <Step1 form={form} update={update} classes={classesQ.data ?? []} />}
          {step === 2 && <Step2 form={form} update={update} />}
          {step === 3 && <Step3 form={form} update={update} />}
          {step === 4 && <Step4 form={form} update={update} schoolId={school.id} />}
          {step === 5 && <Step5 form={form} update={update} classes={classesQ.data ?? []} />}

          <div className="mt-10 flex items-center justify-between border-t border-white/[0.06] pt-6">
            <button
              type="button"
              onClick={back}
              disabled={step === 1}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2 text-sm text-white/80 disabled:opacity-30"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white"
                style={{ background: "var(--tenant-primary, #3b82f6)" }}
              >
                Next <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submitApplication}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--tenant-primary, #3b82f6)" }}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit Application
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step components                                                     */
/* ------------------------------------------------------------------ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/60">
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-white/50">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none";

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
      <span className="text-white/80">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={
          "relative h-6 w-11 rounded-full transition " + (on ? "bg-emerald-500" : "bg-white/15")
        }
      >
        <span
          className={
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " +
            (on ? "left-5" : "left-0.5")
          }
        />
      </button>
    </label>
  );
}

type StepProps = {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
};

function Step1({ form, update, classes }: StepProps & { classes: ClassRow[] }) {
  return (
    <div>
      <SectionLabel>Student Personal Info</SectionLabel>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="First Name" required>
          <input
            className={inputCls}
            value={form.first_name}
            onChange={(e) => update("first_name", e.target.value)}
          />
        </Field>
        <Field label="Last Name" required>
          <input
            className={inputCls}
            value={form.last_name}
            onChange={(e) => update("last_name", e.target.value)}
          />
        </Field>
        <Field label="Date of Birth" required>
          <input
            type="date"
            className={inputCls}
            value={form.dob}
            onChange={(e) => update("dob", e.target.value)}
          />
        </Field>
        <Field label="Gender">
          <select
            className={inputCls}
            value={form.gender}
            onChange={(e) => update("gender", e.target.value)}
          >
            <option value="">Select…</option>
            <option>Male</option>
            <option>Female</option>
          </select>
        </Field>
        <Field label="Nationality">
          <input
            className={inputCls}
            value={form.nationality}
            onChange={(e) => update("nationality", e.target.value)}
          />
        </Field>
        <Field label="Religion">
          <input
            className={inputCls}
            value={form.religion}
            onChange={(e) => update("religion", e.target.value)}
          />
        </Field>
        <Field label="Blood Group">
          <select
            className={inputCls}
            value={form.blood_group}
            onChange={(e) => update("blood_group", e.target.value)}
          >
            <option value="">—</option>
            {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Genotype">
          <select
            className={inputCls}
            value={form.genotype}
            onChange={(e) => update("genotype", e.target.value)}
          >
            <option value="">—</option>
            {["AA", "AS", "SS", "AC", "SC"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="Applying for Class" required>
          <select
            className={inputCls}
            value={form.applying_for_class}
            onChange={(e) => update("applying_for_class", e.target.value)}
          >
            <option value="">Select a class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Academic Year" required>
          <input
            className={inputCls}
            value={form.academic_year}
            onChange={(e) => update("academic_year", e.target.value)}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Home Address" required>
            <textarea
              rows={2}
              className={inputCls}
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Medical Conditions">
            <textarea
              rows={2}
              className={inputCls}
              value={form.medical_conditions}
              onChange={(e) => update("medical_conditions", e.target.value)}
            />
          </Field>
        </div>
        <Toggle
          on={form.has_special_needs}
          onChange={(v) => update("has_special_needs", v)}
          label="Has disabilities or special needs?"
        />
        <Toggle
          on={form.has_allergies}
          onChange={(v) => update("has_allergies", v)}
          label="Has allergies?"
        />
        {form.has_special_needs && (
          <div className="md:col-span-2">
            <Field label="Special Needs Details">
              <textarea
                rows={2}
                className={inputCls}
                value={form.special_needs_detail}
                onChange={(e) => update("special_needs_detail", e.target.value)}
              />
            </Field>
          </div>
        )}
        {form.has_allergies && (
          <div className="md:col-span-2">
            <Field label="Allergy Details">
              <textarea
                rows={2}
                className={inputCls}
                value={form.allergies_detail}
                onChange={(e) => update("allergies_detail", e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function Step2({ form, update }: StepProps) {
  return (
    <div>
      <SectionLabel>Academic History</SectionLabel>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Previous School Name">
          <input
            className={inputCls}
            value={form.previous_school}
            onChange={(e) => update("previous_school", e.target.value)}
          />
        </Field>
        <Field label="Previous School Address">
          <input
            className={inputCls}
            value={form.previous_school_address}
            onChange={(e) => update("previous_school_address", e.target.value)}
          />
        </Field>
        <Field label="Last Class Completed">
          <input
            className={inputCls}
            value={form.previous_class}
            onChange={(e) => update("previous_class", e.target.value)}
          />
        </Field>
        <Field label="Year Completed">
          <input
            className={inputCls}
            value={form.year_completed}
            onChange={(e) => update("year_completed", e.target.value)}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Reason for Leaving">
            <textarea
              rows={2}
              className={inputCls}
              value={form.reason_for_leaving}
              onChange={(e) => update("reason_for_leaving", e.target.value)}
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Academic Achievements or Distinctions">
            <textarea
              rows={3}
              className={inputCls}
              value={form.achievements}
              onChange={(e) => update("achievements", e.target.value)}
            />
          </Field>
        </div>
        <Toggle
          on={form.was_disciplined}
          onChange={(v) => update("was_disciplined", v)}
          label="Ever suspended or expelled?"
        />
        {form.was_disciplined && (
          <div className="md:col-span-2">
            <Field label="Please explain">
              <textarea
                rows={2}
                className={inputCls}
                value={form.discipline_explanation}
                onChange={(e) => update("discipline_explanation", e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function Step3({ form, update }: StepProps) {
  return (
    <div>
      <SectionLabel>Family Details</SectionLabel>
      <h3 className="mb-4 font-display text-base font-semibold">Parent / Guardian One</h3>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Full Name" required>
          <input
            className={inputCls}
            value={form.p1_name}
            onChange={(e) => update("p1_name", e.target.value)}
          />
        </Field>
        <Field label="Relationship" required>
          <select
            className={inputCls}
            value={form.p1_relationship}
            onChange={(e) => update("p1_relationship", e.target.value)}
          >
            <option value="">Select…</option>
            <option>Father</option>
            <option>Mother</option>
            <option>Guardian</option>
            <option>Other</option>
          </select>
        </Field>
        <Field label="Phone" required>
          <input
            className={inputCls}
            value={form.p1_phone}
            onChange={(e) => update("p1_phone", e.target.value)}
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            className={inputCls}
            value={form.p1_email}
            onChange={(e) => update("p1_email", e.target.value)}
          />
        </Field>
        <Field label="Occupation">
          <input
            className={inputCls}
            value={form.p1_occupation}
            onChange={(e) => update("p1_occupation", e.target.value)}
          />
        </Field>
        <Field label="Home Address">
          <input
            className={inputCls}
            value={form.p1_address}
            onChange={(e) => update("p1_address", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-8">
        <Toggle
          on={form.add_parent_two}
          onChange={(v) => update("add_parent_two", v)}
          label="Add second parent / guardian details"
        />
      </div>

      {form.add_parent_two && (
        <>
          <h3 className="mt-8 mb-4 font-display text-base font-semibold">Parent / Guardian Two</h3>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Full Name">
              <input
                className={inputCls}
                value={form.p2_name}
                onChange={(e) => update("p2_name", e.target.value)}
              />
            </Field>
            <Field label="Relationship">
              <input
                className={inputCls}
                value={form.p2_relationship}
                onChange={(e) => update("p2_relationship", e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputCls}
                value={form.p2_phone}
                onChange={(e) => update("p2_phone", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className={inputCls}
                value={form.p2_email}
                onChange={(e) => update("p2_email", e.target.value)}
              />
            </Field>
            <Field label="Occupation">
              <input
                className={inputCls}
                value={form.p2_occupation}
                onChange={(e) => update("p2_occupation", e.target.value)}
              />
            </Field>
            <Field label="Home Address">
              <input
                className={inputCls}
                value={form.p2_address}
                onChange={(e) => update("p2_address", e.target.value)}
              />
            </Field>
          </div>
        </>
      )}

      <h3 className="mt-10 mb-4 font-display text-base font-semibold">Emergency Contact</h3>
      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Name" required>
          <input
            className={inputCls}
            value={form.emergency_name}
            onChange={(e) => update("emergency_name", e.target.value)}
          />
        </Field>
        <Field label="Relationship">
          <input
            className={inputCls}
            value={form.emergency_relationship}
            onChange={(e) => update("emergency_relationship", e.target.value)}
          />
        </Field>
        <Field label="Phone" required>
          <input
            className={inputCls}
            value={form.emergency_phone}
            onChange={(e) => update("emergency_phone", e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function Step4({ form, update, schoolId }: StepProps & { schoolId: string }) {
  const [uploading, setUploading] = useState<string | null>(null);
  const applicationDraftId = useMemo(() => crypto.randomUUID(), []);

  async function onPick(docKey: string, accept: string, maxMb: number, file: File | null) {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`${file.name} exceeds ${maxMb}MB.`);
      return;
    }
    setUploading(docKey);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `admissions/${schoolId}/${applicationDraftId}/${docKey}.${ext}`;
      const { error } = await supabase.storage
        .from("student-documents")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      update("docs", { ...form.docs, [docKey]: { url: path, name: file.name } });
      toast.success(`Uploaded ${file.name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div>
      <SectionLabel>Required Documents</SectionLabel>
      <div className="grid gap-4">
        {REQUIRED_DOCS.map((d) => {
          const uploaded = form.docs[d.key];
          const busy = uploading === d.key;
          return (
            <div
              key={d.key}
              className={
                "rounded-2xl border-2 border-dashed p-5 transition " +
                (uploaded
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20")
              }
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-white">
                    {d.label}
                    {d.optional && <span className="ml-2 text-xs text-white/40">(optional)</span>}
                  </div>
                  <div className="mt-1 text-xs text-white/40">
                    Max {d.maxMb}MB · {d.accept.includes("pdf") ? "PDF or image" : "Image"}
                  </div>
                  {uploaded && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-emerald-300">
                      <Check className="h-4 w-4" /> {uploaded.name}
                    </div>
                  )}
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/90 hover:bg-white/5">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploaded ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept={d.accept}
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => onPick(d.key, d.accept, d.maxMb, e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Step5({ form, update, classes }: StepProps & { classes: ClassRow[] }) {
  const className =
    classes.find((c) => c.name === form.applying_for_class)?.name ?? form.applying_for_class;
  const Row = ({ k, v }: { k: string; v: string | null | undefined }) => (
    <div className="flex justify-between gap-4 border-b border-white/[0.06] py-1.5 text-sm">
      <span className="text-white/50">{k}</span>
      <span className="text-right text-white">{v?.toString().trim() || "—"}</span>
    </div>
  );
  return (
    <div>
      <SectionLabel>Review Your Application</SectionLabel>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <h4 className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-white/60">
            Student
          </h4>
          <Row k="Name" v={`${form.first_name} ${form.last_name}`} />
          <Row k="Date of Birth" v={form.dob} />
          <Row k="Gender" v={form.gender} />
          <Row k="Class" v={className} />
          <Row k="Academic Year" v={form.academic_year} />
          <Row k="Nationality" v={form.nationality} />
          <Row k="Blood / Genotype" v={`${form.blood_group || "—"} / ${form.genotype || "—"}`} />
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <h4 className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-white/60">
            Academic History
          </h4>
          <Row k="Previous School" v={form.previous_school} />
          <Row k="Class Completed" v={form.previous_class} />
          <Row k="Year" v={form.year_completed} />
          <Row k="Disciplined" v={form.was_disciplined ? "Yes" : "No"} />
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <h4 className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-white/60">
            Family
          </h4>
          <Row k="Parent 1" v={`${form.p1_name} (${form.p1_relationship})`} />
          <Row k="Phone" v={form.p1_phone} />
          <Row k="Email" v={form.p1_email} />
          {form.add_parent_two && (
            <Row k="Parent 2" v={`${form.p2_name} (${form.p2_relationship})`} />
          )}
          <Row k="Emergency" v={`${form.emergency_name} (${form.emergency_phone})`} />
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <h4 className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-white/60">
            Documents
          </h4>
          {REQUIRED_DOCS.map((d) => (
            <Row key={d.key} k={d.label} v={form.docs[d.key]?.name ?? "—"} />
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <p className="text-xs leading-relaxed text-white/60">
          I certify that all information provided in this application is true and accurate to the
          best of my knowledge. I understand that providing false information may result in
          cancellation of admission.
        </p>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={form.declaration_ok}
            onChange={(e) => update("declaration_ok", e.target.checked)}
          />
          I agree to the above declaration.
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={form.privacy_ok}
            onChange={(e) => update("privacy_ok", e.target.checked)}
          />
          I have read and agree to the school's Privacy Policy.
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Success + interview                                                 */
/* ------------------------------------------------------------------ */

function SuccessScreen({
  appNumber,
  applicationId,
  onInterview,
  showInterview,
}: {
  appNumber: string;
  applicationId: string;
  onInterview: () => void;
  showInterview: boolean;
}) {
  return (
    <div className="min-h-dvh bg-[#0a0f1e] text-white">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div
          className="mx-auto grid h-16 w-16 place-items-center rounded-full"
          style={{ background: "var(--tenant-primary, #10b981)" }}
        >
          <Check className="h-8 w-8 text-white" />
        </div>
        <h1 className="mt-6 font-display text-4xl font-bold">Application Submitted</h1>
        <p className="mt-3 text-base text-white/60">
          Your application has been received successfully.
        </p>
        <div className="mt-6 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5">
          <span className="text-xs uppercase tracking-widest text-white/50">Application No.</span>
          <span className="font-mono text-base font-bold text-white">{appNumber}</span>
        </div>
        <p className="mx-auto mt-6 max-w-lg text-sm text-white/60">
          We will contact you within 5–7 working days to schedule an interview. Check your email for
          confirmation.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {!showInterview && (
            <button
              onClick={onInterview}
              className="rounded-full border border-white/15 px-6 py-3 text-sm text-white/90 hover:bg-white/5"
            >
              Complete Interview Pre-Screening (Optional)
            </button>
          )}
          <Link
            to="/"
            className="rounded-full px-6 py-3 text-sm font-semibold text-white"
            style={{ background: "var(--tenant-primary, #3b82f6)" }}
          >
            Return to School Website
          </Link>
        </div>
      </div>
      {showInterview && <InterviewModal applicationId={applicationId} />}
    </div>
  );
}

function InterviewModal({ applicationId }: { applicationId: string }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const q = INTERVIEW_QUESTIONS[idx];
  const ans = answers[q.id] ?? "";

  async function submit() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("admission_applications")
        .update({ interview_responses: answers })
        .eq("id", applicationId);
      if (error) throw error;
      setDone(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-white/[0.07] bg-[#0a0f1e] p-8">
        {done ? (
          <div className="text-center">
            <Check className="mx-auto h-12 w-12 text-emerald-400" />
            <h3 className="mt-4 font-display text-2xl font-bold text-white">
              Pre-screening complete
            </h3>
            <p className="mt-2 text-sm text-white/60">
              Thank you. Our admissions team will review your application thoroughly.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/60">
                {q.category}
              </span>
              <span className="text-xs text-white/50">
                Question {idx + 1} of {INTERVIEW_QUESTIONS.length}
              </span>
            </div>
            <h3 className="mt-5 font-display text-xl font-semibold text-white">{q.question}</h3>
            <p className="mt-2 text-xs text-white/40">{q.hint}</p>
            <textarea
              rows={6}
              maxLength={500}
              value={ans}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              className={inputCls + " mt-4"}
              placeholder="Type your answer here (50–500 characters)…"
            />
            <div className="mt-1 text-right text-[11px] text-white/40">{ans.length} / 500</div>
            <div className="mt-6 flex items-center justify-between">
              <button
                disabled={idx === 0}
                onClick={() => setIdx(idx - 1)}
                className="rounded-full border border-white/15 px-5 py-2 text-sm disabled:opacity-30"
              >
                Previous
              </button>
              {idx < INTERVIEW_QUESTIONS.length - 1 ? (
                <button
                  onClick={() => setIdx(idx + 1)}
                  disabled={ans.trim().length < 50}
                  className="rounded-full px-6 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: "var(--tenant-primary, #3b82f6)" }}
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={ans.trim().length < 50 || saving}
                  className="inline-flex items-center gap-2 rounded-full px-6 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: "var(--tenant-primary, #3b82f6)" }}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit Pre-Screening
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[#0a0f1e] px-6 text-center text-white">
      <div>
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        {children && <p className="mt-3 text-sm text-white/60">{children}</p>}
      </div>
    </div>
  );
}
