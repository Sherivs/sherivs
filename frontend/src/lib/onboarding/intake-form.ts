/**
 * M5 part B (ADR-108): form state for the public onboarding intake, shared by /onboarding and
 * /request-demo. The primary action posts to the intake server function. A mailto address is
 * offered only as a visible fallback when that endpoint cannot take the request.
 *
 * The resume token is kept in component state only: never in the URL, storage, or logs.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { turnstileEnabled } from "@/lib/security/turnstile-config";
import { captchaRequired } from "@/components/security/turnstile";
import {
  IntakeRequestSchema,
  invalidFields,
  type IntakeSource,
  type IntakeSubmitResult,
} from "./intake";
import { submitOnboardingRequest } from "./intake.functions";

export type IntakeFormValues = {
  orgName: string;
  institutionType: string;
  state: string;
  lga: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactRole: string;
  note: string;
  consent: boolean;
  website: string;
};

export type IntakeFormStatus =
  "idle" | "error" | "submitting" | "done" | "rate_limited" | "captcha" | "unavailable";

/** Order used to move focus to the first invalid field. */
export const INTAKE_FIELD_ORDER = [
  "orgName",
  "institutionType",
  "state",
  "lga",
  "contactName",
  "contactEmail",
  "contactPhone",
  "contactRole",
  "note",
  "consent",
] as const;

export const INTAKE_FIELD_MESSAGES: Record<(typeof INTAKE_FIELD_ORDER)[number], string> = {
  orgName: "Enter the organization name (2 to 160 characters).",
  institutionType: "Choose the type of organization.",
  state: "Choose a state from the list.",
  lga: "Keep the LGA under 80 characters.",
  contactName: "Enter the admin's name.",
  contactEmail: "Enter a work email address.",
  contactPhone: "Enter a phone number with digits only, for example +234 800 000 0000.",
  contactRole: "Keep the role under 120 characters.",
  note: "Keep the message under 2000 characters.",
  consent: "Confirm you agree to how Sherivs uses these details.",
};

export const EMPTY_INTAKE_VALUES: IntakeFormValues = {
  orgName: "",
  institutionType: "",
  state: "",
  lga: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  contactRole: "",
  note: "",
  consent: false,
  website: "",
};

/** Client-side check with the server's schema. Returns field -> message for invalid fields. */
export function validateIntakeValues(
  values: IntakeFormValues,
  source: IntakeSource,
): Record<string, string> {
  const parsed = IntakeRequestSchema.safeParse({ ...values, source });
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const field of invalidFields(parsed.error)) {
    if (field in INTAKE_FIELD_MESSAGES) {
      errors[field] = INTAKE_FIELD_MESSAGES[field as keyof typeof INTAKE_FIELD_MESSAGES];
    }
  }
  return errors;
}

export function useIntakeForm({
  source,
  idPrefix,
  submit = (data) => submitOnboardingRequest({ data }),
}: {
  source: IntakeSource;
  idPrefix: string;
  submit?: (data: Record<string, unknown>) => Promise<IntakeSubmitResult>;
}) {
  const [values, setValues] = useState<IntakeFormValues>(EMPTY_INTAKE_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<IntakeFormStatus>("idle");
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [captchaReset, setCaptchaReset] = useState(0);
  const focusTarget = useRef<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  useEffect(() => {
    const id = focusTarget.current;
    if (!id) return;
    document.getElementById(id)?.focus();
    focusTarget.current = null;
  }, [focusNonce]);

  const set =
    (key: keyof IntakeFormValues) =>
    (event: { target: { value?: string; checked?: boolean; type?: string } }) => {
      const value =
        event.target.type === "checkbox"
          ? Boolean(event.target.checked)
          : (event.target.value ?? "");
      setValues((current) => ({ ...current, [key]: value as never }));
    };

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (status === "submitting") return;
      const next = validateIntakeValues(values, source);
      setErrors(next);
      if (Object.keys(next).length) {
        const first = INTAKE_FIELD_ORDER.find((key) => next[key]);
        focusTarget.current = first ? `${idPrefix}-${first}` : null;
        setFocusNonce((nonce) => nonce + 1);
        setStatus("error");
        return;
      }
      if (captchaRequired(turnstileEnabled(), captchaToken, captchaUnavailable)) {
        setStatus("captcha");
        return;
      }
      setStatus("submitting");
      try {
        const result = await submit({
          ...values,
          source,
          captchaToken: captchaToken ?? undefined,
        });
        if (result.ok) {
          setResumeToken(result.resumeToken);
          setValues(EMPTY_INTAKE_VALUES);
          setStatus("done");
          return;
        }
        setCaptchaReset((n) => n + 1);
        if (result.code === "rate_limited") setStatus("rate_limited");
        else if (result.code === "captcha_required") setStatus("captcha");
        else if (result.code === "invalid") {
          const fieldErrors: Record<string, string> = {};
          for (const field of result.fields ?? []) {
            if (field in INTAKE_FIELD_MESSAGES) {
              fieldErrors[field] =
                INTAKE_FIELD_MESSAGES[field as keyof typeof INTAKE_FIELD_MESSAGES];
            }
          }
          setErrors(fieldErrors);
          setStatus("error");
        } else setStatus("unavailable");
      } catch {
        setCaptchaReset((n) => n + 1);
        setStatus("unavailable");
      }
    },
    [captchaToken, captchaUnavailable, idPrefix, source, status, submit, values],
  );

  const describedBy = (field: keyof typeof INTAKE_FIELD_MESSAGES, extra?: string) => {
    const ids = [errors[field] ? `${idPrefix}-${field}-error` : null, extra ?? null].filter(
      Boolean,
    );
    return ids.length ? ids.join(" ") : undefined;
  };

  return {
    values,
    errors,
    status,
    resumeToken,
    set,
    onSubmit,
    describedBy,
    captcha: {
      onToken: setCaptchaToken,
      onUnavailable: () => setCaptchaUnavailable(true),
      resetKey: captchaReset,
    },
    /** The mailto fallback is shown only when the endpoint could not take the request. */
    showFallback: status === "unavailable" || (status === "captcha" && captchaUnavailable),
  };
}
