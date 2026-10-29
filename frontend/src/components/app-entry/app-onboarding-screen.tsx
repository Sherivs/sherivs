import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { PublicButton } from "@/components/public/ui";
import { ONBOARDING_MAILBOX, buildOnboardingMailto } from "@/lib/auth/onboarding-request";
import { AppEntryCanvas } from "./app-entry-canvas";

/**
 * Organization administrator request. Sherivs provisions the account.
 * This page never calls Auth sign-up. Submit opens the visitor's email
 * app with a draft to the published hello mailbox. It does not create a
 * ticket and must not claim the request was submitted.
 */
const FIELD_ORDER = ["organization", "name", "email", "message", "consent"] as const;

export function AppOnboardingScreen() {
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState({
    organization: "",
    name: "",
    email: "",
    role: "",
    message: "",
    consent: false,
  });
  const focusTarget = useRef<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  useEffect(() => {
    const id = focusTarget.current;
    if (!id) return;
    document.getElementById(id)?.focus();
    focusTarget.current = null;
  }, [focusNonce]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!values.organization.trim()) next.organization = "Enter the organization name.";
    if (!values.name.trim()) next.name = "Enter the admin's name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
      next.email = "Enter a work email address.";
    if (!values.message.trim())
      next.message = "Describe the organization and who should be the admin.";
    if (!values.consent) next.consent = "Confirm you understand how this request is sent.";
    setErrors(next);
    if (Object.keys(next).length) {
      const first = FIELD_ORDER.find((key) => next[key]);
      focusTarget.current = first ? `onboarding-${first}` : null;
      setFocusNonce((nonce) => nonce + 1);
      setStatus("error");
      return;
    }
    const { href } = buildOnboardingMailto(values);
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
            <h2 id="onboarding-form-heading" className="app-onboard-form-title">
              Organization details
            </h2>
            <p className="app-onboard-support">
              Tell us about your school and the administrator responsible for setting it up.
            </p>

            <form onSubmit={onSubmit} noValidate className="app-onboard-form">
              <fieldset className="app-onboard-group">
                <legend>Organization</legend>
                <div className="app-onboard-fields">
                  <div className="app-onboard-field">
                    <label htmlFor="onboarding-organization">Organization name</label>
                    <input
                      id="onboarding-organization"
                      name="organization"
                      className="app-onboard-input"
                      value={values.organization}
                      onChange={set("organization")}
                      autoComplete="organization"
                      placeholder="School or organization name"
                      aria-required="true"
                      aria-invalid={Boolean(errors.organization)}
                      aria-describedby={
                        errors.organization ? "onboarding-organization-error" : undefined
                      }
                      data-testid="onboarding-first-field"
                    />
                    {errors.organization ? (
                      <em
                        id="onboarding-organization-error"
                        role="alert"
                        className="app-onboard-error"
                      >
                        {errors.organization}
                      </em>
                    ) : null}
                  </div>
                </div>
              </fieldset>

              <fieldset className="app-onboard-group">
                <legend>Administrator</legend>
                <div className="app-onboard-fields">
                  <div className="app-onboard-field">
                    <label htmlFor="onboarding-name">Full name</label>
                    <input
                      id="onboarding-name"
                      name="name"
                      className="app-onboard-input"
                      value={values.name}
                      onChange={set("name")}
                      autoComplete="name"
                      placeholder="Administrator full name"
                      aria-required="true"
                      aria-invalid={Boolean(errors.name)}
                      aria-describedby={errors.name ? "onboarding-name-error" : undefined}
                    />
                    {errors.name ? (
                      <em id="onboarding-name-error" role="alert" className="app-onboard-error">
                        {errors.name}
                      </em>
                    ) : null}
                  </div>
                  <div className="app-onboard-field">
                    <label htmlFor="onboarding-email">Work email</label>
                    <input
                      id="onboarding-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      className="app-onboard-input"
                      value={values.email}
                      onChange={set("email")}
                      autoComplete="email"
                      placeholder="name@organization.com"
                      aria-required="true"
                      aria-invalid={Boolean(errors.email)}
                      aria-describedby={errors.email ? "onboarding-email-error" : undefined}
                    />
                    {errors.email ? (
                      <em id="onboarding-email-error" role="alert" className="app-onboard-error">
                        {errors.email}
                      </em>
                    ) : null}
                  </div>
                  <div className="app-onboard-field">
                    <label htmlFor="onboarding-role">
                      Role or title <span className="app-onboard-optional">(optional)</span>
                    </label>
                    <input
                      id="onboarding-role"
                      name="role"
                      className="app-onboard-input"
                      value={values.role}
                      onChange={set("role")}
                      autoComplete="organization-title"
                      placeholder="Title at the organization"
                    />
                  </div>
                  <div className="app-onboard-field">
                    <label htmlFor="onboarding-message">Message</label>
                    <textarea
                      id="onboarding-message"
                      name="message"
                      className="app-onboard-input app-onboard-textarea"
                      value={values.message}
                      onChange={set("message")}
                      placeholder="What the Sherivs team should know about this organization"
                      aria-required="true"
                      aria-invalid={Boolean(errors.message)}
                      aria-describedby={errors.message ? "onboarding-message-error" : undefined}
                    />
                    {errors.message ? (
                      <em id="onboarding-message-error" role="alert" className="app-onboard-error">
                        {errors.message}
                      </em>
                    ) : null}
                  </div>
                </div>
              </fieldset>

              <p className="app-onboard-note">
                Your request starts the onboarding process. Account access is provided after
                administrator provisioning.
              </p>
              <p className="app-onboard-note">
                Share only the information needed to process your request. Never include passwords.{" "}
                <Link to="/privacy-policy">Privacy policy</Link>
              </p>
              <p className="app-onboard-note" id="onboarding-mailto-note">
                This opens your email app with a draft to {ONBOARDING_MAILBOX}. Nothing is sent
                until you send that message. This page does not create a ticket.
              </p>

              <div className="app-onboard-consent-block">
                <label className="app-onboard-consent" htmlFor="onboarding-consent">
                  <input
                    id="onboarding-consent"
                    name="consent"
                    type="checkbox"
                    checked={values.consent}
                    onChange={set("consent")}
                    aria-required="true"
                    aria-invalid={Boolean(errors.consent)}
                    aria-describedby={
                      errors.consent
                        ? "onboarding-consent-error onboarding-mailto-note"
                        : "onboarding-mailto-note"
                    }
                  />
                  <span>I understand this opens my email app to {ONBOARDING_MAILBOX}.</span>
                </label>
                {errors.consent ? (
                  <em id="onboarding-consent-error" role="alert" className="app-onboard-error">
                    {errors.consent}
                  </em>
                ) : null}
              </div>

              <PublicButton type="submit" className="app-onboard-submit">
                Request administrator access
              </PublicButton>
              <div
                role="status"
                aria-live="polite"
                className="app-onboard-status"
                data-state={status}
              >
                {status === "ready"
                  ? `Your email app should open a draft to ${ONBOARDING_MAILBOX}. Nothing has been submitted until you send that message. If the app did not open, write to ${ONBOARDING_MAILBOX} directly.`
                  : status === "error"
                    ? "Please correct the highlighted fields."
                    : null}
              </div>
            </form>
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
