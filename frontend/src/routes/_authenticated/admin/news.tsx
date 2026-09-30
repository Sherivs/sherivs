import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PortalPage } from "@/components/portal-shell";
import { CrudList, type CrudConfig } from "@/components/admin/crud-list";
import { useApp } from "@/contexts/app-context";

type Row = {
  id: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  category: string | null;
  cover_image_url: string | null;
  is_published: boolean | null;
  is_pinned: boolean | null;
  published_at: string | null;
};

const schema = z.object({
  title: z.string().min(2).max(180),
  excerpt: z.string().max(280).nullable().optional(),
  content: z.string().min(1, "Content is required").max(20000),
  category: z.string().max(60).nullable().optional(),
  cover_image_url: z.string().url().nullable().optional().or(z.literal("")),
  is_published: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  target_audience: z.string().nullable().optional(),
});

function AdminNews() {
  const { profile } = useApp();
  const config: CrudConfig<Row> = {
    table: "news",
    title: "News & announcements",
    emptyHint: "No announcements yet — publish news to keep your community informed.",
    schema,
    orderBy: { column: "created_at", ascending: false },
    defaultValues: { is_published: true, is_pinned: false, target_audience: "all" },
    extraInsertPayload: profile
      ? { author_id: profile.id, published_at: new Date().toISOString() }
      : undefined,
    fields: [
      { key: "title", label: "Title", type: "text", required: true, max: 180 },
      { key: "excerpt", label: "Short summary", type: "textarea", max: 280, rows: 2 },
      { key: "content", label: "Full content", type: "textarea", max: 20000, rows: 8 },
      {
        key: "category",
        label: "Category",
        type: "text",
        max: 60,
        placeholder: "e.g. Sports, Academics",
      },
      { key: "cover_image_url", label: "Cover image URL", type: "url" },
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
      {
        key: "is_pinned",
        label: "Pin to top",
        type: "switch",
        hint: "Show first across the school",
      },
      { key: "is_published", label: "Published", type: "switch", hint: "Visible in user portals" },
    ],
    columns: [
      { key: "title", label: "Title" },
      { key: "category", label: "Category", render: (r) => r.category ?? "—" },
      {
        key: "is_published",
        label: "Status",
        render: (r) => (
          <span
            className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
              r.is_published
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {r.is_published ? "Published" : "Draft"}
          </span>
        ),
      },
      { key: "is_pinned", label: "Pinned", render: (r) => (r.is_pinned ? "★" : "—") },
    ],
  };

  return (
    <PortalPage
      title="News & announcements"
      subtitle="Manage what your community sees in the news feed."
    >
      <CrudList<Row> config={config} />
    </PortalPage>
  );
}

export const Route = createFileRoute("/_authenticated/admin/news")({
  component: AdminNews,
});
