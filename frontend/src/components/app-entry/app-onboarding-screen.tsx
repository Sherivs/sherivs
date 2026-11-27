import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { PublicButton } from "@/components/public/ui";
import { Turnstile } from "@/components/security/turnstile";
import { ONBOARDING_MAILBOX, buildOnboardingMailto } from "@/lib/auth/onboarding-request";
import { useIntakeForm, type IntakeFormValues } from "@/lib/onboarding/intake-form";
import { AppEntryCanvas } from "./app-entry-canvas";

/**
 * Organization administrator request (M5 part B, ADR-108). Sherivs provisions the account.
 * This page never calls Auth sign-up. Submit posts to the onboarding intake server function,
 * which records the request and opens a resumable interview session. A mailto draft is offered
 * only as a visible fallback when the intake endpoint cannot take the request.
 */

/** Coarse organization types; codes follow the master brief §6.1. The interview refines them. */
export const INTAKE_INSTITUTION_TYPES: ReadonlyArray<{
  group: string;
  options: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    group: "Basic and secondary",
    options: [
      ["nursery_ecce", "Nursery or early childhood"],
      ["private_primary", "Private primary school"],
      ["private_secondary", "Private secondary school"],
      ["public_primary", "Public primary school"],
      ["public_secondary", "Public secondary school"],
      ["technical_college", "Technical college"],
      ["islamiyya_sangaya", "Islamiyya or integrated Qur'anic school"],
      ["multi_campus_group", "Group of schools or multi-campus"],
    ],
  },
  {
    group: "Tertiary",
    options: [
      ["university_private", "University (private)"],
      ["university_state", "University (state)"],
      ["university_federal", "University (federal)"],
      ["polytechnic_private", "Polytechnic (private)"],
      ["polytechnic_state", "Polytechnic (state)"],
      ["polytechnic_federal", "Polytechnic (federal)"],
      ["college_of_education_state", "College of education"],
      ["college_of_nursing_midwifery", "College of nursing and midwifery"],
      ["college_of_health_technology", "College of health technology"],
      ["college_of_agriculture", "College of agriculture"],
    ],
  },
  {
    group: "Government and agencies",
    options: [
      ["state_ministry_of_education", "State ministry of education"],
      ["subeb", "SUBEB"],
      ["lgea", "LGEA"],
    ],
  },
  { group: "Other", options: [["other", "Other organization"]] },
];

export const INTAKE_NIGERIAN_STATES: readonly string[] = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT Abuja",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
  "Outside Nigeria",
];

export function onboardingFallbackHref(values: IntakeFormValues): string {
  return buildOnboardingMailto({
    organization: values.orgName,
    name: values.contactName,
    email: values.contactEmail,
    role: values.contactRole,
    message: values.note,
  }).href;
}

const P = "onboarding";

export function AppOnboardingScreen() {
  const form = useIntakeForm({ source: "public_onboarding", idPrefix: P });
  const { values, errors, status, set, describedBy } = form;

  const fieldError = (field: string) =>
    errors[field] ? (
      <em id={`${P}-${field}-error`} role="alert" className="app-onboard-error">
        {errors[field]}
      </em>
    ) : null;

  return (
    <AppEntryCanvas align="start" tone="login" wide>
      <main id="main-content" className="app-onboard" data-testid="app-entry-onboarding">
        <header className="app-onboard-bar">
          <SherivsLogo size={32} lettering="brand" />
          <Link to="/" className="app-onboard-back">
            <ChevronLeft size={16} aria-hidden="true" />
            Back to Sign In
          </Link>
        </header>

        <div className="app-onboard-layout">
          <section className="app-onboard-intro" aria-labelledby="onboarding-heading">
            <h1 id="onboarding-heading" className="app-onboard-title">
              Bring your school into Sherivs.
            </h1>
            <p className="app-onboard-lead">
              Request an administrator account to set up your organization, configure school
              operations, and invite your community into Sherivs Scholar.
            </p>
            <h2 className="app-onboard-process">What happens next</h2>
            <ol className="app-onboard-steps">
              <li>
                <span className="app-onboard-step-index">01</span>
                <span>
                  <span className="app-onboard-step-title">Submit your request</span>
                  <span className="app-onboard-step-copy">
                    Share your organization details and administrator contact information.
                  </span>
                </span>
              </li>
              <li>
                <span className="app-onboard-step-index">02</span>
                <span>
                  <span className="app-onboard-step-title">Account provisioning</span>
                  <span className="app-onboard-step-copy">
                    The Sherivs team reviews your request and provisions your organization
                    administrator account.
                  </span>
                </span>
              </li>
              <li>
                <span className="app-onboard-step-index">03</span>
                <span>
                  <span className="app-onboard-step-title">Set up your school</span>
                  <span className="app-onboard-step-copy">
                    Configure your school operations and invite authorized administrators, staff,
                    teachers, students, and parents as appropriate.
                  </span>
                </span>
              </li>
            </ol>
          </section>

          <section className="app-onboard-card" aria-labelledby="onboarding-form-heading">
            {status === "done" ? (
              <div className="app-onboard-form" data-testid="onboarding-intake-done">
                <h2
                  id="onboarding-form-heading"
                  className="app-onboard-form-title"
                  tabIndex={-1}
                  ref={(el) => el?.focus()}
                >
                  Request received
                </h2>
                <p className="app-onboard-support">
                  The Sherivs team will review your request and reply to the work email you gave. No
                  account has been created yet.
                </p>
                <p className="app-onboard-note">
                  The next step is a short interview about how your organization runs. It is not
                  open on this page yet: we will continue your interview by link.
                </p>
                {form.resumeToken ? (
                  <div className="app-onboard-field">
                    <label htmlFor={`${P}-resume-code`}>Your resume code (shown once)</label>
                    <input
                      id={`${P}-resume-code`}
                      className="app-onboard-input"
                      readOnly
                      value={form.resumeToken}
                      aria-describedby={`${P}-resume-note`}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <p id={`${P}-resume-note`} className="app-onboard-note">
                      Keep this code private. It lets you continue the interview within 30 days.
                      Sherivs stores only a fingerprint of it, so we cannot show it to you again.
                    </p>
                  </div>
                ) : null}
                <div role="status" aria-live="polite" className="app-onboard-status">
                  Request received. We will continue your interview by link.
                </div>
              </div>
            ) : (
              <>
                <h2 id="onboarding-form-heading" className="app-onboard-form-title">
                  Organization details
                </h2>
                <p className="app-onboard-support">
                  Tell us about your school and the administrator responsible for setting it up.
                </p>

                <form onSubmit={form.onSubmit} noValidate className="app-onboard-form">
                  <fieldset className="app-onboard-group">
                    <legend>Organization</legend>
                    <div className="app-onboard-fields">
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-orgName`}>Organization name</label>
                        <input
                          id={`${P}-orgName`}
                          name="orgName"
                          className="app-onboard-input"
                          value={values.orgName}
                          onChange={set("orgName")}
                          autoComplete="organization"
                          placeholder="School or organization name"
                          maxLength={160}
                          aria-required="true"
                          aria-invalid={Boolean(errors.orgName)}
                          aria-describedby={describedBy("orgName")}
                          data-testid="onboarding-first-field"
                        />
                        {fieldError("orgName")}
                      </div>
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-institutionType`}>Organization type</label>
                        <select
                          id={`${P}-institutionType`}
                          name="institutionType"
                          className="app-onboard-input"
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
                        {fieldError("institutionType")}
                      </div>
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-state`}>
                          State <span className="app-onboard-optional">(optional)</span>
                        </label>
                        <select
                          id={`${P}-state`}
                          name="state"
                          className="app-onboard-input"
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
                        {fieldError("state")}
                      </div>
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-lga`}>
                          LGA <span className="app-onboard-optional">(optional)</span>
                        </label>
                        <input
                          id={`${P}-lga`}
                          name="lga"
                          className="app-onboard-input"
                          value={values.lga}
                          onChange={set("lga")}
                          maxLength={80}
                          placeholder="Local government area"
                          aria-invalid={Boolean(errors.lga)}
                          aria-describedby={describedBy("lga")}
                        />
                        {fieldError("lga")}
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="app-onboard-group">
                    <legend>Administrator</legend>
                    <div className="app-onboard-fields">
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-contactName`}>Full name</label>
                        <input
                          id={`${P}-contactName`}
                          name="contactName"
                          className="app-onboard-input"
                          value={values.contactName}
                          onChange={set("contactName")}
                          autoComplete="name"
                          placeholder="Administrator full name"
                          maxLength={120}
                          aria-required="true"
                          aria-invalid={Boolean(errors.contactName)}
                          aria-describedby={describedBy("contactName")}
                        />
                        {fieldError("contactName")}
                      </div>
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-contactEmail`}>Work email</label>
                        <input
                          id={`${P}-contactEmail`}
                          name="contactEmail"
                          type="email"
                          inputMode="email"
                          autoCapitalize="none"
                          autoCorrect="off"
                          className="app-onboard-input"
                          value={values.contactEmail}
                          onChange={set("contactEmail")}
                          autoComplete="email"
                          placeholder="name@organization.com"
                          maxLength={254}
                          aria-required="true"
                          aria-invalid={Boolean(errors.contactEmail)}
                          aria-describedby={describedBy("contactEmail")}
                        />
                        {fieldError("contactEmail")}
                      </div>
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-contactPhone`}>
                          Phone <span className="app-onboard-optional">(optional)</span>
                        </label>
                        <input
                          id={`${P}-contactPhone`}
                          name="contactPhone"
                          type="tel"
                          inputMode="tel"
                          className="app-onboard-input"
                          value={values.contactPhone}
                          onChange={set("contactPhone")}
                          autoComplete="tel"
                          placeholder="+234 800 000 0000"
                          maxLength={24}
                          aria-invalid={Boolean(errors.contactPhone)}
                          aria-describedby={describedBy("contactPhone")}
                        />
                        {fieldError("contactPhone")}
                      </div>
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-contactRole`}>
                          Role or title <span className="app-onboard-optional">(optional)</span>
                        </label>
                        <input
                          id={`${P}-contactRole`}
                          name="contactRole"
                          className="app-onboard-input"
                          value={values.contactRole}
                          onChange={set("contactRole")}
                          autoComplete="organization-title"
                          placeholder="Title at the organization"
                          maxLength={120}
                          aria-invalid={Boolean(errors.contactRole)}
                          aria-describedby={describedBy("contactRole")}
                        />
                        {fieldError("contactRole")}
                      </div>
                      <div className="app-onboard-field">
                        <label htmlFor={`${P}-note`}>
                          Message <span className="app-onboard-optional">(optional)</span>
                        </label>
                        <textarea
                          id={`${P}-note`}
                          name="note"
                          className="app-onboard-input app-onboard-textarea"
                          value={values.note}
                          onChange={set("note")}
                          maxLength={2000}
                          placeholder="What the Sherivs team should know about this organization"
                          aria-invalid={Boolean(errors.note)}
                          aria-describedby={describedBy("note")}
                        />
                        {fieldError("note")}
                      </div>
                    </div>
                  </fieldset>

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

                  <p className="app-onboard-note">
                    Your request starts the onboarding process. Account access is provided after
                    administrator provisioning.
                  </p>
                  <p className="app-onboard-note">
                    Share only the information needed to process your request. Never include
                    passwords. <Link to="/privacy">Privacy notice</Link>
                  </p>
                  <p className="app-onboard-note" id={`${P}-consent-note`}>
                    Sherivs uses these details only to review this request, contact you about it,
                    and prepare your organization&apos;s setup. Unfinished interview answers are
                    deleted after 30 days.
                  </p>

                  <div className="app-onboard-consent-block">
                    <label className="app-onboard-consent" htmlFor={`${P}-consent`}>
                      <input
                        id={`${P}-consent`}
                        name="consent"
                        type="checkbox"
                        checked={values.consent}
                        onChange={set("consent")}
                        aria-required="true"
                        aria-invalid={Boolean(errors.consent)}
                        aria-describedby={describedBy("consent", `${P}-consent-note`)}
                      />
                      <span>I agree that Sherivs may use these details for this request.</span>
                    </label>
                    {fieldError("consent")}
                  </div>

                  <Turnstile {...form.captcha} />

                  <PublicButton
                    type="submit"
                    className="app-onboard-submit"
                    disabled={status === "submitting"}
                  >
                    {status === "submitting" ? "Sending request…" : "Request administrator access"}
                  </PublicButton>
                  <div
                    role="status"
                    aria-live="polite"
                    className="app-onboard-status"
                    data-state={status}
                  >
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
                    <p className="app-onboard-note" data-testid="onboarding-mailto-fallback">
                      You can also{" "}
                      <a href={onboardingFallbackHref(values)}>
                        email your request to {ONBOARDING_MAILBOX}
                      </a>
                      . That opens your email app; nothing is sent until you send the message.
                    </p>
                  ) : null}
                </form>
              </>
            )}
            <p className="app-onboard-legal">
              Already invited?{" "}
              <Link to="/" search={{ panel: "signin" }}>
                Sign in
              </Link>
            </p>
          </section>
        </div>
      </main>
    </AppEntryCanvas>
  );
}
