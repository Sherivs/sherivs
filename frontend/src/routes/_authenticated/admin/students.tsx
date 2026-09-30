import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { CrudList, type CrudConfig } from "@/components/admin/crud-list";

export const Route = createFileRoute("/_authenticated/admin/students")({
  ssr: false,
  component: StudentsPage,
});

type Row = {
  id: string;
  admission_number: string | null;
  class_id: string | null;
  date_of_birth: string | null;
  gender: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  enrollment_date: string | null;
  is_active: boolean | null;
};

function StudentsPage() {
  const { school } = useApp();
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!school?.id) return;
    supabase
      .from("classes")
      .select("id, name")
      .eq("school_id", school.id)
      .order("name")
      .then(({ data }) => setClasses((data as { id: string; name: string }[]) ?? []));
  }, [school?.id]);

  const config: CrudConfig<Row> = {
    table: "students",
    title: "Students",
    emptyHint: "No student records yet. Add students to start managing enrollment.",
    schema: z.object({
      admission_number: z.string().trim().min(1, "Admission number is required").max(40),
      class_id: z.string().uuid().nullable(),
      date_of_birth: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
        .nullable()
        .or(z.literal("").transform(() => null)),
      gender: z
        .enum(["male", "female", "other"])
        .nullable()
        .or(z.literal("").transform(() => null)),
      parent_name: z.string().trim().max(120).nullable(),
      parent_phone: z.string().trim().max(40).nullable(),
      parent_email: z
        .string()
        .trim()
        .toLowerCase()
        .email()
        .nullable()
        .or(z.literal("").transform(() => null)),
      enrollment_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .or(z.literal("").transform(() => null)),
      is_active: z.boolean().default(true),
    }),
    fields: [
      { key: "admission_number", label: "Admission number", type: "text", required: true, max: 40 },
      {
        key: "class_id",
        label: "Class",
        type: "select",
        options: classes.map((c) => ({ value: c.id, label: c.name })),
      },
      { key: "date_of_birth", label: "Date of birth", type: "text", placeholder: "YYYY-MM-DD" },
      {
        key: "gender",
        label: "Gender",
        type: "select",
        options: [
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
          { value: "other", label: "Other" },
        ],
      },
      { key: "parent_name", label: "Parent / guardian name", type: "text", max: 120 },
      { key: "parent_phone", label: "Parent phone", type: "text", max: 40 },
      { key: "parent_email", label: "Parent email", type: "email", max: 255 },
      { key: "enrollment_date", label: "Enrollment date", type: "text", placeholder: "YYYY-MM-DD" },
      { key: "is_active", label: "Active", type: "switch", hint: "Currently enrolled" },
    ],
    columns: [
      { key: "admission_number", label: "Admission #" },
      {
        key: "class_id",
        label: "Class",
        render: (r) => classes.find((c) => c.id === r.class_id)?.name ?? "—",
      },
      { key: "parent_name", label: "Parent" },
      { key: "parent_phone", label: "Phone" },
      { key: "is_active", label: "Active", render: (r) => (r.is_active ? "Yes" : "No") },
    ],
    orderBy: { column: "admission_number", ascending: true },
    defaultValues: { is_active: true },
  };

  return (
    <PortalPage title="Students" subtitle="Enrollment records for your school">
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back to dashboard
        </Link>
      </div>
      <CrudList config={config} />
    </PortalPage>
  );
}
