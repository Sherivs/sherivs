import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/gov/about")({ ssr: false, component: GovAbout });

function GovAbout() {
  return (
    <section className="max-w-2xl space-y-3 text-sm">
      <h1 className="text-xl font-semibold">About this data</h1>
      <p>Only schools that have chosen to share with your ministry or board appear here, and a school can withdraw at any time.</p>
      <p>You see totals and percentages, never individual learners or staff. Any figure built from fewer than 10 students is hidden and shown as "&lt;10", so that no child can be identified.</p>
      <p>Every view is recorded. Access is granted by Sherivs per state or LGA. This processing follows the Nigeria Data Protection Act 2023.</p>
    </section>
  );
}
