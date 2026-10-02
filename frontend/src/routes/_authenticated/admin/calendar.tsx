import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PortalPage } from "@/components/portal-shell";
import { CrudList, type CrudConfig } from "@/components/admin/crud-list";
import { CalendarMonth } from "@/components/calendar-month";
import { useApp } from "@/contexts/app-context";
import { notifyCalendarEvent } from "@/lib/runtime/scholar/notifications-fanout.functions";

type Row = {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  event_type: string | null;
  location: string | null;
  all_day: boolean | null;
};

const schema = z.object({
  title: z.string().min(2).max(180),
  description: z.string().max(2000).nullable().optional(),
  start_date: z.string().min(8),
  end_date: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  location: z.string().max(180).nullable().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  all_day: z.boolean().optional(),
  target_audience: z.string().nullable().optional(),
});

function AdminCalendar() {
  const { profile } = useApp();
  const notifyFn = useServerFn(notifyCalendarEvent);

  const config: CrudConfig<Row> = {
    table: "school_calendar",
    title: "School calendar",
    emptyHint: "No events on the calendar yet — add holidays, exams, parent-teacher meetings, etc.",
    schema,
    orderBy: { column: "start_date", ascending: true },
    defaultValues: { all_day: true, target_audience: "all" },
    extraInsertPayload: profile ? { created_by: profile.id } : undefined,
    onAfterCreate: async (row) => {
      try {
        const res = await notifyFn({
          data: {
            event_id: row.id as string,
            title: (row.title as string) ?? "Event",
            start_date: (row.start_date as string) ?? new Date().toISOString().slice(0, 10),
            event_type: (row.event_type as string | null) ?? null,
            target_audience: ((row.target_audience as string) ?? "all") as
              "all" | "parents" | "teachers" | "students",
          },
        });
        if (res?.notified)
          toast.success(`Notified ${res.notified} ${res.notified === 1 ? "person" : "people"}`);
      } catch (e) {
        const m = e instanceof Error ? e.message : "Notify failed";
        toast.error(m);
      }
    },
    fields: [
      { key: "title", label: "Title", type: "text", required: true, max: 180 },
      { key: "description", label: "Description", type: "textarea", max: 2000, rows: 3 },
      { key: "start_date", label: "Start date", type: "date", required: true },
      { key: "end_date", label: "End date (optional)", type: "date" },
      { key: "all_day", label: "All day", type: "switch", hint: "Hide time fields" },
      { key: "start_time", label: "Start time", type: "time" },
      { key: "end_time", label: "End time", type: "time" },
      {
        key: "event_type",
        label: "Type",
        type: "select",
        options: [
          { value: "holiday", label: "Holiday" },
          { value: "exam", label: "Exam" },
          { value: "event", label: "Event" },
          { value: "meeting", label: "Meeting" },
          { value: "term", label: "Term marker" },
        ],
      },
      {
        key: "target_audience",
        label: "Audience",
        type: "select",
        options: [
          { value: "all", label: "Everyone" },
          { value: "students", label: "Students" },
          { value: "teachers", label: "Teachers" },
          { value: "parents", label: "Parents" },
        ],
      },
      { key: "location", label: "Location", type: "text", max: 180 },
    ],
    columns: [
      {
        key: "start_date",
        label: "Date",
        render: (r) => (
          <span className="font-mono text-xs">
            {r.start_date}
            {r.end_date && r.end_date !== r.start_date ? ` → ${r.end_date}` : ""}
          </span>
        ),
      },
      { key: "title", label: "Title" },
      { key: "event_type", label: "Type", render: (r) => r.event_type ?? "—" },
      { key: "location", label: "Location", render: (r) => r.location ?? "—" },
    ],
  };

  return (
    <PortalPage
      title="Calendar"
      subtitle="Holidays, exams, events and meetings published to your school."
    >
      <CalendarMonth />
      <CrudList<Row> config={config} />
    </PortalPage>
  );
}

export const Route = createFileRoute("/_authenticated/admin/calendar")({
  component: AdminCalendar,
});
