/**
 * Starter content for v2 content types (SHERIVS-101), generated from the organization's facts and onboarding
 * answers. Standard, factual texts a Nigerian school publishes (code of conduct, NDPA privacy notice,
 * safeguarding/anti-bullying). They are drafts the school reviews in /admin/website before publishing;
 * nothing claims facts the school did not give (names, phone and email come from its profile).
 * Text is stored in the default language only; other languages fall back to it (never machine-faked).
 */
import type { OrgKind } from "./generator";
import type { Localized, SiteData } from "./types";

type Own = (s: string) => Localized;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const minors = (k: OrgKind) => k === "nursery_primary" || k === "secondary" || k === "k12";
const tertiary = (k: OrgKind) => k === "university" || k === "polytechnic";

export function seedRules(kind: OrgKind, own: Own, boarding: boolean) {
  if (kind === "government" || kind === "group" || kind === "other") return [];
  const g = (title: string, rules: string[]) => ({
    title: own(title),
    rules: own(rules.join("\n")),
  });
  if (tertiary(kind))
    return [
      g("Academic integrity", [
        "Examination malpractice, plagiarism and impersonation are serious offences.",
        "Submit only your own work and acknowledge every source.",
        "Attend at least 75% of lectures in a course to sit its examination.",
      ]),
      g("Conduct on campus", [
        "Membership of secret cults and any form of hazing are prohibited.",
        "Respect staff, fellow students and visitors; harassment of any kind is not tolerated.",
        "Carry your student identity card at all times on campus.",
      ]),
      g("Safety and property", [
        "Weapons, drugs and alcohol are not allowed on campus.",
        "Report damage, fire risks and suspicious activity to campus security.",
      ]),
    ];
  const young = kind === "nursery_primary";
  return [
    g("Punctuality and attendance", [
      young
        ? "Pupils should arrive before the morning assembly."
        : "Students must be in school before the assembly bell.",
      "Absence must be explained by a parent or guardian in writing or by phone.",
      "No pupil leaves the premises during school hours without permission.",
    ]),
    g("Uniform and appearance", [
      "Wear the approved school uniform neatly every school day.",
      "Hair should be neat and simple; jewellery and make-up are not allowed.",
    ]),
    g("Respect and conduct", [
      "Treat teachers, staff, visitors and classmates with courtesy.",
      "Bullying, fighting and abusive language are not tolerated.",
      young
        ? "Keep the classroom and school tidy."
        : "Examination malpractice is a serious offence.",
    ]),
    g(young ? "Safety" : "Devices and property", [
      young
        ? "Pupils are released only to parents or adults they have named."
        : "Mobile phones are not allowed in class unless a teacher permits it.",
      "Take care of school property; damage is repaired at the family's cost.",
    ]),
    ...(boarding
      ? [
          g("Boarding house", [
            "Follow the house timetable for prep, meals and lights-out.",
            "Visiting is on approved visiting days only.",
          ]),
        ]
      : []),
  ];
}

export function seedPolicies(d: SiteData, kind: OrgKind, own: Own, ob: Record<string, unknown>) {
  const s = d.school;
  const out: Record<string, unknown>[] = [];
  const contact = [s.email, s.phone].filter(Boolean).join(" or ");
  if (contact)
    out.push({
      kind: "privacy",
      title: own("Privacy notice (NDPA 2023)"),
      summary: own(
        `How ${s.name} collects, uses and protects personal data under the Nigeria Data Protection Act 2023.`,
      ),
      body: own(
        [
          `${s.name} is the data controller for the personal data of ${tertiary(kind) ? "students, applicants" : "pupils, parents and guardians"}, staff and visitors.`,
          "**What we collect:** names, contact details, admission and academic records, attendance, health information needed for care, and payment records.",
          "**Why:** to admit and teach, keep everyone safe, communicate with families and meet legal duties. We do not sell personal data.",
          "**Sharing:** only with examination bodies, regulators and service providers who process data for us under contract, or where the law requires it.",
          "**Your rights:** you may ask to see, correct or delete your data, object to some uses, or withdraw consent. You may also complain to the Nigeria Data Protection Commission (NDPC).",
          `**Contact:** ${contact}.`,
        ].join("\n\n"),
      ),
    });
  if (minors(kind)) {
    out.push({
      kind: "safeguarding",
      title: own("Child protection and safeguarding"),
      summary: own(
        "Every child has the right to be safe. All staff are trained to recognise and report concerns.",
      ),
      body: own(
        [
          "We follow the Child Rights Act 2003 and the relevant state child protection laws.",
          "- Concerns about a child are reported the same day to the designated safeguarding lead.",
          "- Staff and volunteers are vetted before they start and are never alone with a child behind closed doors.",
          "- Children are released only to parents or adults the family has named.",
          contact ? `To raise a concern, contact the school on ${contact}.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    });
    out.push({
      kind: "anti_bullying",
      title: own("Anti-bullying policy"),
      summary: own(
        "Bullying in any form, including online, is not tolerated. Every report is taken seriously.",
      ),
      body: own(
        [
          "- Pupils can report to any teacher, and parents can contact the school directly.",
          "- Reports are recorded and investigated promptly, and both families are informed.",
          "- We support the child who was bullied and work with the child who bullied to change behaviour.",
        ].join("\n"),
      ),
    });
  }
  if (d.admissions?.requirements)
    out.push({
      kind: "admissions",
      title: own("Admissions policy"),
      summary: own("Who we admit and how."),
      body: own(String(d.admissions.requirements)),
    });
  // Policies the school wrote during onboarding (fees & refund, uniform, ICT, ...).
  const given = obj(ob.policies);
  const KNOWN: Record<string, string> = {
    fees_refund: "Fees and refund policy",
    uniform: "Uniform policy",
    ict: "ICT and acceptable use policy",
    health: "Health and medication policy",
    attendance: "Attendance policy",
    assessment: "Assessment and promotion policy",
    complaints: "Complaints procedure",
  };
  for (const [k, title] of Object.entries(KNOWN)) {
    const v = given[k];
    const text = str(typeof v === "string" ? v : obj(v).text);
    const file = str(obj(v).file);
    if (text || file)
      out.push({
        kind: k,
        title: own(title),
        ...(text ? { body: own(text) } : {}),
        ...(file ? { file } : {}),
      });
  }
  return out;
}

export function seedCalendar(ob: Record<string, unknown>, own: Own) {
  return arr(obj(ob.academic).terms ?? ob.terms)
    .map(obj)
    .filter((t) => str(t.name) && DATE.test(str(t.starts)))
    .map((t) => ({
      label: own(str(t.name)),
      starts: str(t.starts),
      ...(DATE.test(str(t.ends)) ? { ends: str(t.ends) } : {}),
      ...(str(t.note) ? { note: own(str(t.note)) } : {}),
    }));
}
export function seedPta(ob: Record<string, unknown>, own: Own) {
  const p = obj(ob.pta);
  const executives = arr(p.executives)
    .map(obj)
    .filter((x) => str(x.name))
    .map((x) => ({ name: str(x.name), role: own(str(x.role)) }));
  return {
    ...(str(p.about) ? { intro: own(str(p.about)) } : {}),
    ...(str(p.meetings) ? { meetings: own(str(p.meetings)) } : {}),
    ...(str(p.contact) ? { contact: str(p.contact) } : {}),
    executives,
  };
}
export function seedDownloads(ob: Record<string, unknown>, own: Own) {
  return arr(ob.downloads)
    .map(obj)
    .filter((x) => str(x.label) && str(x.href))
    .map((x) => ({
      label: own(str(x.label)),
      href: str(x.href),
      ...(str(x.group) ? { group: str(x.group) } : {}),
    }));
}
export function seedCareers(ob: Record<string, unknown>, own: Own) {
  return arr(ob.vacancies)
    .map(obj)
    .filter((x) => str(x.title))
    .map((x) => ({
      title: own(str(x.title)),
      ...(str(x.type) ? { type: str(x.type) } : {}),
      ...(DATE.test(str(x.closes)) ? { closes: str(x.closes) } : {}),
      ...(str(x.summary) ? { summary: own(str(x.summary)) } : {}),
      ...(str(x.apply) ? { apply_href: str(x.apply) } : {}),
    }));
}
