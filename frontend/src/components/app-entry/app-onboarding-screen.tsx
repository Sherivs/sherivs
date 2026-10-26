import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, UserPlus } from "lucide-react";
import { PLATFORM_NAME } from "@/lib/platform";
import { SherivsMark } from "@/components/brand/sherivs-logo";
import { ONBOARDING_MAILBOX, buildOnboardingMailto } from "@/lib/auth/onboarding-request";
import { AppEntryCanvas } from "./app-entry-canvas";
import { AppEntryWordmark } from "./app-entry-wordmark";

/**
 * Create Account destination. Sherivs provisions the organization admin.
 * Admins then invite users by email with login credentials. This page never
 * calls Auth sign-up.
 */
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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!values.organization.trim()) next.organization = "Enter the organization name.";
    if (!values.name.trim()) next.name = "Enter the admin's name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) next.email = "Enter a work email address.";
    if (!values.message.trim()) next.message = "Describe the organization and who should be the admin.";
    if (!values.consent) next.consent = "Confirm you understand how this request is sent.";
    setErrors(next);
    if (Object.keys(next).length) {
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
      const value = event.target.type === "checkbox" ? Boolean(event.target.checked) : event.target.value ?? "";
      setValues((current) => ({ ...current, [key]: value as never }));
    };

  return (
    <AppEntryCanvas align="start">
      <header className="app-entry-brand">
        <div className="app-entry-mark-wrap">
          <SherivsMark size={56} decorative className="app-entry-mark" />
        </div>
        <AppEntryWordmark />
      </header>

      <section className="app-entry-panel" data-testid="app-entry-onboarding" aria-labelledby="onboarding-heading">
        <Link to="/" className="app-entry-back">
          <ChevronLeft size={16} aria-hidden="true" />
          Back to Sign In
        </Link>
        <h2 id="onboarding-heading">Create an account</h2>
        <p className="app-entry-panel-lead">
          {PLATFORM_NAME} creates your organization's admin account. There is no
          self-service sign-up. After that, the admin invites every other user by
          email with login credentials — those users only sign in.
        </p>
        <ol className="app-entry-steps">
          <li>
            <span className="app-entry-step-index">1</span>
            <span>Send this request to the {PLATFORM_NAME} team.</span>
          </li>
          <li>
            <span className="app-entry-step-index">2</span>
            <span>The team provisions the organization admin account.</span>
          </li>
          <li>
            <span className="app-entry-step-index">3</span>
            <span>That admin invites users by email with their sign-in credentials.</span>
          </li>
        </ol>

        <form onSubmit={onSubmit} noValidate className="app-entry-form">
          <p className="app-entry-panel-lead" style={{ marginTop: 0 }}>
            This form opens your email client to {ONBOARDING_MAILBOX}. {PLATFORM_NAME}{" "}
            does not create a ticket until that message is received. Do not include
            passwords.
          </p>
          <label className="app-entry-field">
            <span>Organization</span>
            <input
              className="app-entry-input"
              value={values.organization}
              onChange={set("organization")}
              autoComplete="organization"
              aria-invalid={Boolean(errors.organization)}
            />
            {errors.organization ? (
              <em className="app-entry-alert-error" style={{ display: "block", marginTop: "0.4rem", fontStyle: "normal" }}>
                {errors.organization}
              </em>
            ) : null}
          </label>
          <label className="app-entry-field">
            <span>Admin name</span>
            <input
              className="app-entry-input"
              value={values.name}
              onChange={set("name")}
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name ? (
              <em className="app-entry-alert-error" style={{ display: "block", marginTop: "0.4rem", fontStyle: "normal" }}>
                {errors.name}
              </em>
            ) : null}
          </label>
          <label className="app-entry-field">
            <span>Work email</span>
            <input
              type="email"
              className="app-entry-input"
              value={values.email}
              onChange={set("email")}
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email ? (
              <em className="app-entry-alert-error" style={{ display: "block", marginTop: "0.4rem", fontStyle: "normal" }}>
                {errors.email}
              </em>
            ) : null}
          </label>
          <label className="app-entry-field">
            <span>Role or title</span>
            <input className="app-entry-input" value={values.role} onChange={set("role")} autoComplete="organization-title" />
          </label>
          <label className="app-entry-field">
            <span>Message</span>
            <textarea
              className="app-entry-input"
              style={{ minHeight: "7rem" }}
              value={values.message}
              onChange={set("message")}
              aria-invalid={Boolean(errors.message)}
            />
            {errors.message ? (
              <em className="app-entry-alert-error" style={{ display: "block", marginTop: "0.4rem", fontStyle: "normal" }}>
                {errors.message}
              </em>
            ) : null}
          </label>
          <label className="app-entry-consent">
            <input type="checkbox" checked={values.consent} onChange={set("consent")} />
            <span>
              I understand this opens my email client to {ONBOARDING_MAILBOX}. See the{" "}
              <Link to="/privacy-policy">privacy policy</Link>.
            </span>
          </label>
          {errors.consent ? (
            <div role="alert" className="app-entry-alert app-entry-alert-error">
              {errors.consent}
            </div>
          ) : null}
          <button type="submit" className="app-entry-card app-entry-card-primary app-entry-submit">
            <span className="app-entry-glass-icon" aria-hidden="true">
              <UserPlus />
            </span>
            Email the {PLATFORM_NAME} team
          </button>
          <div role="status" aria-live="polite" className="app-entry-alert-info" style={{ padding: "0.2rem 0" }}>
            {status === "ready"
              ? `If your email client did not open, write to ${ONBOARDING_MAILBOX} directly. This page does not claim a ticket was created.`
              : status === "error"
                ? "Please correct the highlighted fields."
                : null}
          </div>
        </form>
        <p className="app-entry-legal">
          Already invited?{" "}
          <Link to="/" search={{ panel: "signin" }}>
            Sign in
          </Link>
        </p>
      </section>
    </AppEntryCanvas>
  );
}
