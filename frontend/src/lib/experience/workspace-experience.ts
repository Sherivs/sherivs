/**
 * Sherivs — workspace experience resolver (Phase 24 Experience wave).
 *
 * Domain-neutral member experience: localized (i18n-extensible, `en` shipped)
 * time-of-day greeting resolved against the member's REAL post title (primary
 * position when held, else the coarse membership label). Consumed by shell
 * surfaces; never authorization logic.
 */
export type DayPart = "morning" | "afternoon" | "evening" | "night";
export type ExperienceLocale = "en";

export const SHELL_TIME_ZONE = "Africa/Lagos";

const GREETINGS: Readonly<Record<ExperienceLocale, Record<DayPart, string>>> = {
  en: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    night: "Good night",
  },
};

export function dayPartForHour(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function greetingForHour(hour: number, locale: ExperienceLocale = "en"): string {
  const part = dayPartForHour(hour);
  return GREETINGS[locale][part];
}

/** Hour 0–23 in an IANA zone. Shell greetings use Africa/Lagos (WAT). */
export function hourInTimeZone(at: Date, timeZone: string = SHELL_TIME_ZONE): number {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).format(at);
  const hour = Number.parseInt(formatted, 10);
  if (!Number.isFinite(hour)) return at.getUTCHours();
  return hour === 24 ? 0 : hour;
}

export function clockInTimeZone(at: Date, timeZone: string = SHELL_TIME_ZONE): string {
  const clock = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(at);
  return `${clock} WAT`;
}

export interface MemberWorkspaceExperienceInput {
  hour: number;
  memberLabel: string;
  /** Canonical real post title when the member holds a primary position. */
  positionTitle?: string | null;
  locale?: ExperienceLocale;
}

export interface MemberWorkspaceExperience {
  greeting: string;
  roleTitle: string;
}

/** Resolve the member's workspace experience (greeting + display role). */
export function resolveMemberWorkspaceExperience(
  input: MemberWorkspaceExperienceInput,
): MemberWorkspaceExperience {
  const { hour, memberLabel, positionTitle, locale = "en" } = input;
  return {
    greeting: greetingForHour(hour, locale),
    roleTitle: positionTitle?.trim() ? positionTitle.trim() : memberLabel,
  };
}
