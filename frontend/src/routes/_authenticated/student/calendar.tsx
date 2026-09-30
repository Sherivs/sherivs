import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { CalendarList } from "@/components/calendar-list";
import { CalendarMonth } from "@/components/calendar-month";

export const Route = createFileRoute("/_authenticated/student/calendar")({
  component: () => (
    <PortalPage
      title="School calendar"
      subtitle="What's coming up at school. Non-school days are shaded."
    >
      <CalendarMonth />
      <CalendarList />
    </PortalPage>
  ),
});
