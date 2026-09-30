import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { CalendarList } from "@/components/calendar-list";
import { CalendarMonth } from "@/components/calendar-month";

export const Route = createFileRoute("/_authenticated/teacher/calendar")({
  component: () => (
    <PortalPage
      title="School calendar"
      subtitle="Upcoming events, holidays and meetings. Non-school days are shaded."
    >
      <CalendarMonth />
      <CalendarList />
    </PortalPage>
  ),
});
