/**
 * Scholar runtime contributions to the organization public experience.
 *
 * These sections load only when the Scholar runtime is the installed runtime
 * for the tenant. The platform organization-public engine stays domain-neutral.
 */
import type { RuntimePublicContribution } from "@/lib/experience/organization-public";

export const SCHOLAR_PUBLIC_SECTION_CONTRIBUTION: RuntimePublicContribution = {
  runtimeId: "runtime:scholar",
  sections: [
    { id: "admissions", title: "Admissions" },
    { id: "programs", title: "Programs" },
    { id: "faculty", title: "Faculty" },
    { id: "facilities", title: "Facilities" },
    { id: "sports", title: "Sports" },
    { id: "meals", title: "Meals" },
    { id: "transport", title: "Transport" },
    { id: "faqs", title: "FAQs" },
    { id: "testimonials", title: "Testimonials" },
    { id: "gallery", title: "Gallery" },
  ],
};
