import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { CalendarList } from "@/components/calendar-list";
import { CalendarMonth } from "@/components/calendar-month";

export const Route = createFileRoute("/_authenticated/parent/calendar")({
  component: () => (
    <PortalPage
      title="School calendar"
      subtitle="Stay on top of holidays, exams and parent events. Non-school days are shaded."
    >
      <CalendarMonth />
      <CalendarList />
    </PortalPage>
  ),
});
