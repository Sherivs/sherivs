import { useMemo, useState, type FormEvent } from "react";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { EMAIL_ROUTING } from "@/lib/public-site/company";
import { Field, PublicButton, inputClass } from "@/components/public/ui";

export type MailtoKind = "demo" | "contact" | "support";

type Inquiry = "general" | "prospect" | "partnership";

const SUBJECT: Record<MailtoKind, string> = {
  demo: "Demo request",
  contact: "Contact Sherivs",
  support: "Support request",
};

function routeTo(kind: MailtoKind, inquiry: Inquiry): string {
  if (kind === "support") return PUBLIC_CONTACTS.support;
  if (kind === "demo") return PUBLIC_CONTACTS.hello;
  if (inquiry === "general") return PUBLIC_CONTACTS.info;
  return PUBLIC_CONTACTS.hello;
}

export function MailtoForm({ kind }: { kind: MailtoKind }) {
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState({
    name: "",
    email: "",
    organization: "",
    role: "",
    orgType: "education",
    interest: "",
    size: "",
    severity: "normal",
    category: "question",
    inquiry: "prospect" as Inquiry,
    message: "",
    followUp: "email",
    reference: "",
    consent: false,
  });

  const to = routeTo(kind, values.inquiry);
  const purpose =
    kind === "support"
      ? EMAIL_ROUTING.support.purpose
      : kind === "demo"
        ? EMAIL_ROUTING.hello.purpose
        : values.inquiry === "general"
          ? EMAIL_ROUTING.info.purpose
          : EMAIL_ROUTING.hello.purpose;

  const privacy = useMemo(
    () =>
      `This form opens your email client and addresses ${to} (${purpose}). Sherivs does not create a ticket until that message is received. Do not include passwords or unnecessary personal data.`,
    [to, purpose],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
      next.email = "Enter a work email address.";
    if (!values.message.trim()) next.message = "Describe what you need.";
    if (!values.consent) next.consent = "Confirm you understand how this message is sent.";
    setErrors(next);
    if (Object.keys(next).length) {
      setStatus("error");
      return;
    }
    const subject =
      kind === "contact"
        ? values.inquiry === "partnership"
          ? "Partnership inquiry"
          : values.inquiry === "general"
            ? "General inquiry"
            : "Prospective customer inquiry"
        : SUBJECT[kind];
    const body = [
      `Name: ${values.name}`,
      `Work email: ${values.email}`,
      values.organization && `Organization: ${values.organization}`,
      values.role && `Role: ${values.role}`,
      kind !== "support" && `Organization type: ${values.orgType}`,
      kind === "contact" && `Inquiry type: ${values.inquiry}`,
      values.interest && `Area of interest: ${values.interest}`,
      values.size && `Approximate size: ${values.size}`,
      kind === "support" && `Category: ${values.category}`,
      kind === "support" && `Severity: ${values.severity}`,
      kind === "support" && values.reference && `Reference: ${values.reference}`,
      `Preferred follow-up: ${values.followUp}`,
      "",
      values.message,
    ]
      .filter(Boolean)
      .join("\n");
    const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    setStatus("ready");
  };

  const set =
    (key: keyof typeof values) =>
    (event: { target: { value?: string; checked?: boolean; type?: string } }) => {
      const value =
        event.target.type === "checkbox"
          ? Boolean(event.target.checked)
          : (event.target.value ?? "");
      setValues((current) => ({ ...current, [key]: value as never }));
    };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="sherivs-glass-card grid gap-4 rounded-[var(--sherivs-radius-lg)] p-6 sm:p-8"
    >
      <p className="text-sm text-sherivs-muted">{privacy}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${kind}-name`} label="Name" error={errors.name}>
          <input
            id={`${kind}-name`}
            name="name"
            autoComplete="name"
            className={inputClass}
            value={values.name}
            onChange={set("name")}
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
        <Field id={`${kind}-email`} label="Work email" error={errors.email}>
          <input
            id={`${kind}-email`}
            name="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            value={values.email}
            onChange={set("email")}
            aria-invalid={Boolean(errors.email)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${kind}-org`} label="Organization">
          <input
            id={`${kind}-org`}
            name="organization"
            className={inputClass}
            value={values.organization}
            onChange={set("organization")}
          />
        </Field>
        <Field id={`${kind}-role`} label="Role">
          <input
            id={`${kind}-role`}
            name="role"
            className={inputClass}
            value={values.role}
            onChange={set("role")}
          />
        </Field>
      </div>
      {kind === "contact" ? (
        <Field id={`${kind}-inquiry`} label="What is this about?">
          <select
            id={`${kind}-inquiry`}
            className={inputClass}
            value={values.inquiry}
            onChange={set("inquiry")}
          >
            <option value="prospect">Prospective customer or demonstration</option>
            <option value="partnership">Partnership or business development</option>
            <option value="general">General company or administrative inquiry</option>
          </select>
        </Field>
      ) : null}
      {kind !== "support" ? (
        <Field id={`${kind}-type`} label="Organization type">
          <select
            id={`${kind}-type`}
            className={inputClass}
            value={values.orgType}
            onChange={set("orgType")}
          >
            <option value="education">Education</option>
            <option value="enterprise">Enterprise</option>
            <option value="research">Research</option>
            <option value="other">Other</option>
          </select>
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${kind}-category`} label="Issue category">
            <select
              id={`${kind}-category`}
              className={inputClass}
              value={values.category}
              onChange={set("category")}
            >
              <option value="question">Question</option>
              <option value="access">Access</option>
              <option value="billing">Billing</option>
              <option value="outage">Suspected outage</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field id={`${kind}-severity`} label="Severity">
            <select
              id={`${kind}-severity`}
              className={inputClass}
              value={values.severity}
              onChange={set("severity")}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </Field>
        </div>
      )}
      {kind === "support" ? (
        <Field id={`${kind}-ref`} label="Reference ID (optional)">
          <input
            id={`${kind}-ref`}
            className={inputClass}
            value={values.reference}
            onChange={set("reference")}
            autoComplete="off"
          />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${kind}-interest`} label="Area of interest">
            <input
              id={`${kind}-interest`}
              className={inputClass}
              value={values.interest}
              onChange={set("interest")}
            />
          </Field>
          <Field id={`${kind}-size`} label="Approximate organization size">
            <input
              id={`${kind}-size`}
              className={inputClass}
              value={values.size}
              onChange={set("size")}
            />
          </Field>
        </div>
      )}
      <Field id={`${kind}-message`} label="Message" error={errors.message}>
        <textarea
          id={`${kind}-message`}
          className={`${inputClass} min-h-32 py-2`}
          value={values.message}
          onChange={set("message")}
          aria-invalid={Boolean(errors.message)}
        />
      </Field>
      <Field id={`${kind}-follow`} label="Preferred follow-up">
        <select
          id={`${kind}-follow`}
          className={inputClass}
          value={values.followUp}
          onChange={set("followUp")}
        >
          <option value="email">Email</option>
        </select>
      </Field>
      <Field id={`${kind}-consent`} label="Privacy" error={errors.consent}>
        <label className="flex items-start gap-2 text-sm text-sherivs-muted">
          <input
            id={`${kind}-consent`}
            type="checkbox"
            className="mt-1"
            checked={values.consent}
            onChange={set("consent")}
          />
          <span>
            I understand this opens my email client to {to}. See the{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href="/privacy">
              privacy policy
            </a>
            .
          </span>
        </label>
      </Field>
      <PublicButton type="submit">Open email to {to}</PublicButton>
      <div role="status" aria-live="polite" className="text-sm text-sherivs-muted">
        {status === "ready"
          ? `If your email client did not open, write to ${to} directly. This page does not claim a ticket was created.`
          : status === "error"
            ? "Please correct the highlighted fields."
            : null}
      </div>
    </form>
  );
}
