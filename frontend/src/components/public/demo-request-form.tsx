import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { Field, PublicButton, inputClass } from "@/components/public/ui";
import { Turnstile } from "@/components/security/turnstile";
import { useIntakeForm } from "@/lib/onboarding/intake-form";
import {
  INTAKE_INSTITUTION_TYPES,
  INTAKE_NIGERIAN_STATES,
  onboardingFallbackHref,
} from "@/components/app-entry/app-onboarding-screen";

/**
 * /request-demo form (M5 part B, ADR-108). Posts to the onboarding intake server function with
 * source "public_demo". A mailto link appears only as a fallback when the endpoint is unavailable.
 */
const P = "demo";

export function DemoRequestForm() {
  const form = useIntakeForm({ source: "public_demo", idPrefix: P });
  const { values, errors, status, set, describedBy } = form;

  if (status === "done") {
    return (
      <div
        className="sherivs-glass-card grid gap-4 rounded-[var(--sherivs-radius-lg)] p-6 sm:p-8"
        data-testid="demo-intake-done"
      >
        <h2 className="font-display text-xl font-semibold" tabIndex={-1} ref={(el) => el?.focus()}>
          Request received
        </h2>
        <p className="text-sm text-sherivs-muted">
          The Sherivs team will reply to the work email you gave to arrange the demo. No account has
          been created.
        </p>
        <p className="text-sm text-sherivs-muted">
          Setting up an organization starts with a short interview. It is not open on this page yet:
          we will continue your interview by link.
        </p>
        {form.resumeToken ? (
          <Field id={`${P}-resume-code`} label="Your resume code (shown once)">
            <input
              id={`${P}-resume-code`}
              readOnly
              className={inputClass}
              value={form.resumeToken}
              aria-describedby={`${P}-resume-note`}
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>
        ) : null}
        <p id={`${P}-resume-note`} className="text-xs text-sherivs-muted">
          Keep this code private. Sherivs stores only a fingerprint of it and cannot show it again.
        </p>
        <div role="status" aria-live="polite" className="text-sm text-sherivs-muted">
          Request received. We will continue your interview by link.
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.onSubmit}
      noValidate
      className="sherivs-glass-card grid gap-4 rounded-[var(--sherivs-radius-lg)] p-6 sm:p-8"
    >
      <p id={`${P}-consent-note`} className="text-sm text-sherivs-muted">
        Sherivs uses these details only to arrange your demo, review your request and contact you
        about it. Do not include passwords or unnecessary personal data.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${P}-contactName`} label="Name" error={errors.contactName}>
          <input
            id={`${P}-contactName`}
            name="contactName"
            autoComplete="name"
            maxLength={120}
            className={inputClass}
            value={values.contactName}
            onChange={set("contactName")}
            aria-required="true"
            aria-invalid={Boolean(errors.contactName)}
            aria-describedby={describedBy("contactName")}
          />
        </Field>
        <Field id={`${P}-contactEmail`} label="Work email" error={errors.contactEmail}>
          <input
            id={`${P}-contactEmail`}
            name="contactEmail"
            type="email"
            autoComplete="email"
            maxLength={254}
            className={inputClass}
            value={values.contactEmail}
            onChange={set("contactEmail")}
            aria-required="true"
            aria-invalid={Boolean(errors.contactEmail)}
            aria-describedby={describedBy("contactEmail")}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${P}-orgName`} label="Organization" error={errors.orgName}>
          <input
            id={`${P}-orgName`}
            name="orgName"
            autoComplete="organization"
            maxLength={160}
            className={inputClass}
            value={values.orgName}
            onChange={set("orgName")}
            aria-required="true"
            aria-invalid={Boolean(errors.orgName)}
            aria-describedby={describedBy("orgName")}
          />
        </Field>
        <Field id={`${P}-institutionType`} label="Organization type" error={errors.institutionType}>
          <select
            id={`${P}-institutionType`}
            name="institutionType"
            className={inputClass}
            value={values.institutionType}
            onChange={set("institutionType")}
            aria-required="true"
            aria-invalid={Boolean(errors.institutionType)}
            aria-describedby={describedBy("institutionType")}
          >
            <option value="">Choose one</option>
            {INTAKE_INSTITUTION_TYPES.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.options.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${P}-state`} label="State (optional)" error={errors.state}>
          <select
            id={`${P}-state`}
            name="state"
            className={inputClass}
            value={values.state}
            onChange={set("state")}
            aria-invalid={Boolean(errors.state)}
            aria-describedby={describedBy("state")}
          >
            <option value="">Choose a state</option>
            {INTAKE_NIGERIAN_STATES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${P}-contactPhone`} label="Phone (optional)" error={errors.contactPhone}>
          <input
            id={`${P}-contactPhone`}
            name="contactPhone"
            type="tel"
            autoComplete="tel"
            maxLength={24}
            className={inputClass}
            value={values.contactPhone}
            onChange={set("contactPhone")}
            aria-invalid={Boolean(errors.contactPhone)}
            aria-describedby={describedBy("contactPhone")}
          />
        </Field>
      </div>
      <Field id={`${P}-contactRole`} label="Role (optional)" error={errors.contactRole}>
        <input
          id={`${P}-contactRole`}
          name="contactRole"
          maxLength={120}
          className={inputClass}
          value={values.contactRole}
          onChange={set("contactRole")}
          aria-invalid={Boolean(errors.contactRole)}
          aria-describedby={describedBy("contactRole")}
        />
      </Field>
      <Field id={`${P}-note`} label="Message (optional)" error={errors.note}>
        <textarea
          id={`${P}-note`}
          name="note"
          maxLength={2000}
          className={`${inputClass} min-h-32 py-2`}
          value={values.note}
          onChange={set("note")}
          aria-invalid={Boolean(errors.note)}
          aria-describedby={describedBy("note")}
        />
      </Field>
      {/* Honeypot: hidden from people and assistive technology; bots fill it. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-10000px", width: 1, height: 1 }}
      >
        <label htmlFor={`${P}-website`}>Leave this field empty</label>
        <input
          id={`${P}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={set("website")}
        />
      </div>
      <Field id={`${P}-consent`} label="Privacy" error={errors.consent}>
        <label className="flex items-start gap-2 text-sm text-sherivs-muted">
          <input
            id={`${P}-consent`}
            name="consent"
            type="checkbox"
            className="mt-1"
            checked={values.consent}
            onChange={set("consent")}
            aria-required="true"
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={describedBy("consent", `${P}-consent-note`)}
          />
          <span>
            I agree that Sherivs may use these details for this request. See the{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href="/privacy">
              privacy policy
            </a>
            .
          </span>
        </label>
      </Field>
      <Turnstile {...form.captcha} />
      <PublicButton type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending request…" : "Request a demo"}
      </PublicButton>
      <div role="status" aria-live="polite" className="text-sm text-sherivs-muted">
        {status === "error"
          ? "Please correct the highlighted fields."
          : status === "captcha"
            ? "Complete the security check, then send the request again."
            : status === "rate_limited"
              ? "Too many requests from this network. Wait a few minutes and try again."
              : status === "unavailable"
                ? "We could not record your request just now. Nothing was saved."
                : null}
      </div>
      {form.showFallback ? (
        <p className="text-sm text-sherivs-muted" data-testid="demo-mailto-fallback">
          You can also{" "}
          <a
            className="text-sherivs-cyan underline-offset-4 hover:underline"
            href={onboardingFallbackHref(values)}
          >
            email your request to {PUBLIC_CONTACTS.hello}
          </a>
          . That opens your email app; nothing is sent until you send the message.
        </p>
      ) : null}
    </form>
  );
}
