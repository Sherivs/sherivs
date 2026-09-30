import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { PortalPage } from "@/components/portal-shell";
import { CrudList } from "@/components/admin/crud-list";

export const Route = createFileRoute("/_authenticated/admin/grades")({
  ssr: false,
  component: AdminGradesPage,
});

const schema = z.object({
  student_id: z.string().uuid("Student ID must be a UUID"),
  class_id: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(1).max(80),
  ca_score: z.number().min(0).max(100).nullable().optional(),
  exam_score: z.number().min(0).max(100).nullable().optional(),
  total_score: z.number().min(0).max(100).nullable().optional(),
  grade: z.string().trim().max(4).nullable().optional(),
  grade_remark: z.string().trim().max(120).nullable().optional(),
  term: z.string().trim().max(40).nullable().optional(),
  academic_year: z.string().trim().max(20).nullable().optional(),
  is_published: z.boolean().default(false),
});

type Row = {
  id: string;
  student_id: string;
  subject: string;
  ca_score: number | null;
  exam_score: number | null;
  total_score: number | null;
  grade: string | null;
  term: string | null;
  academic_year: string | null;
  is_published: boolean | null;
};

function AdminGradesPage() {
  return (
    <PortalPage
      title="Grades"
      subtitle="Record CA + exam scores per subject. Publish to make report cards visible to students and parents."
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Dashboard
        </Link>
        <Link
          to="/admin/students"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          Students
        </Link>
      </div>
      <CrudList<Row>
        config={{
          table: "grades",
          title: "Grade records",
          emptyHint: "No grades recorded yet.",
          schema,
          orderBy: { column: "created_at", ascending: false },
          defaultValues: { is_published: false },
          columns: [
            { key: "subject", label: "Subject" },
            { key: "ca_score", label: "CA" },
            { key: "exam_score", label: "Exam" },
            { key: "total_score", label: "Total" },
            { key: "grade", label: "Grade" },
            { key: "term", label: "Term" },
            { key: "academic_year", label: "Year" },
            {
              key: "is_published",
              label: "Published",
              render: (r) => (r.is_published ? "✓" : "—"),
            },
            {
              key: "student_id",
              label: "Student",
              render: (r) => <code className="text-xs">{r.student_id.slice(0, 8)}…</code>,
            },
          ],
          fields: [
            { key: "student_id", label: "Student ID (UUID)", type: "text", required: true },
            { key: "class_id", label: "Class ID (UUID, optional)", type: "text" },
            { key: "subject", label: "Subject", type: "text", required: true },
            { key: "ca_score", label: "CA score (0-100)", type: "number" },
            { key: "exam_score", label: "Exam score (0-100)", type: "number" },
            { key: "total_score", label: "Total (0-100)", type: "number" },
            { key: "grade", label: "Grade (A, B…)", type: "text" },
            { key: "grade_remark", label: "Remark", type: "text" },
            { key: "term", label: "Term", type: "text", placeholder: "1st / 2nd / 3rd" },
            {
              key: "academic_year",
              label: "Academic year",
              type: "text",
              placeholder: "2025/2026",
            },
            { key: "is_published", label: "Published to students/parents", type: "switch" },
          ],
        }}
      />
    </PortalPage>
  );
}
