/** Preview personas: synthetic schools and users that exercise the engine exactly like the server does
 *  (template permissions + admin optional toggles + scope sets + plan/modules). Used by /ux-lab and tests. */
import templates from "./role-templates.data";
import { computeWorkspace, type EffectivePermission, type Scope, type WorkspaceInput, type WorkspacePrefs } from "./engine";

export interface DemoOrg { id: string; name: string; plan: "starter" | "growth" | "enterprise"; modulesOff?: string[]; optionalOff?: Record<string, string[]> }
const PLAN_FEATURES = { starter: ["core", "sms"], growth: ["core", "sms", "whatsapp", "ai"], enterprise: ["core", "sms", "whatsapp", "ai", "voice", "codegen"] };
const MODULES = ["cbt", "wallet", "payroll", "library", "hostel", "health", "transport"];
export const orgFeatures = (o: DemoOrg) => [...PLAN_FEATURES[o.plan], ...MODULES.filter((m) => !o.modulesOff?.includes(m))];

export const ORGS = {
  lekki: { id: "org-lekki", name: "Lekki Heritage Academy", plan: "growth" } as DemoOrg,
  ikeja: { id: "org-ikeja", name: "Government Secondary School, Ikeja", plan: "starter", modulesOff: ["library", "hostel", "transport"], optionalOff: { teacher: ["cbt.manage"] } } as DemoOrg,
  stgreg: { id: "org-stgreg", name: "St. Gregory's Boarding College", plan: "growth" } as DemoOrg,
  fedpoly: { id: "org-fedpoly", name: "Federal Polytechnic Ilaro-East", plan: "growth", modulesOff: ["hostel"] } as DemoOrg,
  unisav: { id: "org-unisav", name: "Federal University of the Savannah", plan: "enterprise" } as DemoOrg,
  ubec: { id: "org-lsubeb", name: "Lagos State Ministry of Education (oversight)", plan: "enterprise" } as DemoOrg,
};

export interface PersonaRole { template: string; code: string; name: string; scope?: Scope }
export interface Persona { id: string; name: string; title: string; org: DemoOrg; roles: PersonaRole[]; prefs?: WorkspacePrefs }

export function inputFor(p: Persona): WorkspaceInput {
  const perms = new Map<string, Scope[]>();
  for (const r of p.roles) {
    const off = new Set(p.org.optionalOff?.[r.template] ?? []);
    for (const [code, kind, on] of templates[r.template] ?? []) {
      if (kind === "o" && (!on || off.has(code))) continue;
      perms.set(code, [...(perms.get(code) ?? []), r.scope ?? { type: "org", ref: null }]);
    }
  }
  const permissions: EffectivePermission[] = [...perms].map(([code, scopes]) => ({ code, scopes }));
  return { org: { id: p.org.id, name: p.org.name, plan: p.org.plan, features: orgFeatures(p.org) }, roles: p.roles.map((r) => ({ code: r.code, template: r.template, name: r.name })), permissions, prefs: p.prefs };
}
export const manifestFor = (p: Persona, prefs?: WorkspacePrefs) => computeWorkspace({ ...inputFor(p), prefs: prefs ?? p.prefs });

const R = (template: string, name: string, scope?: Scope): PersonaRole => ({ template, code: `ng.${template}`, name, scope });
const cls = (dims: Record<string, string[]>): Scope => ({ type: "set", ref: null, dims });
export const PERSONAS: Persona[] = [
  { id: "proprietor", name: "Chief (Mrs) Adaeze Okafor", title: "Proprietor", org: ORGS.lekki, roles: [R("proprietor", "Proprietor")] },
  { id: "principal", name: "Mr Babatunde Adeyemi", title: "Principal", org: ORGS.lekki, roles: [R("head_of_institution", "Principal")] },
  { id: "bursar", name: "Mrs Ngozi Eze", title: "Bursar", org: ORGS.lekki, roles: [R("bursar", "Bursar")] },
  { id: "registrar", name: "Dr Musa Bello", title: "Registrar", org: ORGS.unisav, roles: [R("registrar", "Registrar")] },
  { id: "hod", name: "Dr Funmilayo Ogunleye", title: "HOD, Sciences", org: ORGS.stgreg, roles: [R("hod", "Head of Department", cls({ subject: ["Biology", "Chemistry", "Physics"] }))] },
  { id: "teacher-a", name: "Mr Emeka Nwosu", title: "Mathematics teacher", org: ORGS.lekki, roles: [R("teacher", "Mathematics teacher", cls({ level: ["JSS2"], subject: ["Mathematics"] }))] },
  { id: "teacher-b", name: "Mrs Aisha Danjuma", title: "Mathematics teacher + form teacher JSS2B", org: ORGS.ikeja,
    roles: [R("teacher", "Mathematics teacher", cls({ level: ["JSS2", "JSS3"], subject: ["Mathematics"], shift: ["Morning"] })), R("form_teacher", "Form teacher", cls({ class: ["JSS2B"] }))] },
  { id: "form-teacher", name: "Miss Chiamaka Obi", title: "Form teacher, SS1A", org: ORGS.stgreg, roles: [R("form_teacher", "Form teacher", cls({ class: ["SS1A"] }))] },
  { id: "exams", name: "Mr Yusuf Garba", title: "Exams officer", org: ORGS.fedpoly, roles: [R("exams_officer", "Exams & records officer")] },
  { id: "hr", name: "Mrs Kemi Alabi", title: "HR & payroll officer", org: ORGS.unisav, roles: [R("payroll", "Payroll officer")] },
  { id: "nurse", name: "Nurse Blessing Udo", title: "School nurse", org: ORGS.stgreg, roles: [R("health", "Nurse")] },
  { id: "librarian", name: "Mr Ibrahim Sani", title: "Librarian", org: ORGS.unisav, roles: [R("librarian", "Librarian")] },
  { id: "hostel", name: "Mrs Grace Akpan", title: "Hostel matron, Queen Amina House", org: ORGS.stgreg, roles: [R("hostel_head", "Hostel head", cls({ hostel: ["Queen Amina"] }))] },
  { id: "transport", name: "Mr Sunday Okon", title: "Bus driver, Route 3", org: ORGS.lekki, roles: [R("driver", "Driver")] },
  { id: "security", name: "Mr Danladi Usman", title: "Head of security", org: ORGS.stgreg, roles: [R("security_head", "Head of security")] },
  { id: "parent", name: "Mrs Folake Bakare", title: "Parent of 2", org: ORGS.lekki, roles: [R("parent", "Parent")] },
  { id: "student", name: "Tolu Bakare", title: "JSS2 student", org: ORGS.lekki, roles: [R("student", "Student")] },
  { id: "gov", name: "Mrs Hauwa Abdullahi", title: "Quality assurance officer", org: ORGS.ubec, roles: [R("regulator_inspector", "Inspector")] },
];
export const persona = (id: string) => PERSONAS.find((p) => p.id === id) ?? PERSONAS[5];
