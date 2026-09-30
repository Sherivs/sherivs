import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { PortalPage } from "@/components/portal-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CrudList, type CrudConfig } from "@/components/admin/crud-list";
import { MealsTab, TransportTab } from "@/components/admin/facilities-forms";
import { useApp } from "@/contexts/app-context";

export const Route = createFileRoute("/_authenticated/admin/cms")({
  ssr: false,
  component: CmsPage,
});

/* ---------- entity configs ---------- */

const programsConfig: CrudConfig<{
  id: string;
  name: string;
  description: string | null;
  age_range: string | null;
  duration: string | null;
  is_published: boolean | null;
  order_index: number | null;
}> = {
  table: "academic_programs",
  title: "Academic programs",
  emptyHint: "No programs yet. Add one to populate the Programs section of your public site.",
  schema: z.object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(2000).nullable(),
    age_range: z.string().trim().max(60).nullable(),
    duration: z.string().trim().max(60).nullable(),
    is_published: z.boolean().default(true),
    order_index: z.number().int().min(0).max(999).nullable(),
  }),
  fields: [
    { key: "name", label: "Name", type: "text", required: true, max: 120 },
    { key: "age_range", label: "Age range", type: "text", placeholder: "5–11", max: 60 },
    { key: "duration", label: "Duration", type: "text", placeholder: "6 years", max: 60 },
    { key: "description", label: "Description", type: "textarea", max: 2000 },
    { key: "order_index", label: "Display order", type: "number" },
    { key: "is_published", label: "Published", type: "switch", hint: "Visible on the public site" },
  ],
  columns: [
    { key: "name", label: "Name" },
    { key: "age_range", label: "Age range" },
    { key: "duration", label: "Duration" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
  ],
  orderBy: { column: "order_index", ascending: true },
  defaultValues: { is_published: true },
};

const newsConfig: CrudConfig<{
  id: string;
  title: string;
  content: string;
  excerpt: string | null;
  category: string | null;
  is_published: boolean | null;
  is_pinned: boolean | null;
  published_at: string | null;
}> = {
  table: "news",
  title: "News & announcements",
  emptyHint: "No news posts yet. Add one to populate the News section of your public site.",
  schema: z.object({
    title: z.string().trim().min(1).max(200),
    excerpt: z.string().trim().max(300).nullable(),
    content: z.string().trim().min(1).max(20000),
    category: z.string().trim().max(60).nullable(),
    is_published: z.boolean().default(true),
    is_pinned: z.boolean().default(false),
  }),
  fields: [
    { key: "title", label: "Title", type: "text", required: true, max: 200 },
    { key: "excerpt", label: "Excerpt", type: "textarea", rows: 2, max: 300 },
    { key: "content", label: "Content", type: "textarea", rows: 8, max: 20000, required: true },
    {
      key: "category",
      label: "Category",
      type: "text",
      placeholder: "Events, Academics…",
      max: 60,
    },
    { key: "is_published", label: "Published", type: "switch", hint: "Visible on the public site" },
    { key: "is_pinned", label: "Pinned", type: "switch", hint: "Pin to the top of the news list" },
  ],
  columns: [
    { key: "title", label: "Title" },
    { key: "category", label: "Category" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
    { key: "is_pinned", label: "Pinned", render: (r) => (r.is_pinned ? "★" : "") },
  ],
  orderBy: { column: "created_at", ascending: false },
  defaultValues: { is_published: true, is_pinned: false },
};

const testimonialsConfig: CrudConfig<{
  id: string;
  name: string;
  role: string;
  content: string;
  rating: number | null;
  avatar_url: string | null;
  is_published: boolean | null;
}> = {
  table: "testimonials",
  title: "Testimonials",
  emptyHint: "No testimonials yet. Add real quotes from parents, alumni, or staff.",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(1500),
    rating: z.number().int().min(1).max(5).nullable(),
    avatar_url: z
      .string()
      .trim()
      .url()
      .nullable()
      .or(z.literal("").transform(() => null)),
    is_published: z.boolean().default(true),
  }),
  fields: [
    { key: "name", label: "Name", type: "text", required: true, max: 120 },
    { key: "role", label: "Role (parent, alumnus, etc.)", type: "text", required: true, max: 120 },
    { key: "content", label: "Quote", type: "textarea", rows: 4, max: 1500, required: true },
    { key: "rating", label: "Rating (1–5)", type: "number" },
    { key: "avatar_url", label: "Avatar URL", type: "url", placeholder: "https://" },
    { key: "is_published", label: "Published", type: "switch" },
  ],
  columns: [
    { key: "name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "rating", label: "Rating" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
  ],
  orderBy: { column: "created_at", ascending: false },
  defaultValues: { is_published: true },
};

const faqsConfig: CrudConfig<{
  id: string;
  question: string;
  answer: string;
  category: string | null;
  is_published: boolean | null;
  order_index: number | null;
}> = {
  table: "faqs",
  title: "FAQs",
  emptyHint: "No FAQs yet. Add answers to the questions parents ask most.",
  schema: z.object({
    question: z.string().trim().min(1).max(300),
    answer: z.string().trim().min(1).max(4000),
    category: z.string().trim().max(60).nullable(),
    is_published: z.boolean().default(true),
    order_index: z.number().int().min(0).max(999).nullable(),
  }),
  fields: [
    { key: "question", label: "Question", type: "text", required: true, max: 300 },
    { key: "answer", label: "Answer", type: "textarea", rows: 5, max: 4000, required: true },
    { key: "category", label: "Category", type: "text", placeholder: "Admissions, Fees…", max: 60 },
    { key: "order_index", label: "Display order", type: "number" },
    { key: "is_published", label: "Published", type: "switch" },
  ],
  columns: [
    { key: "question", label: "Question" },
    { key: "category", label: "Category" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
  ],
  orderBy: { column: "order_index", ascending: true },
  defaultValues: { is_published: true },
};

const whyUsConfig: CrudConfig<{
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  is_published: boolean | null;
  order_index: number | null;
}> = {
  table: "why_us_items",
  title: "Why us",
  emptyHint: "No reasons yet. Add 3–6 reasons families choose your school.",
  schema: z.object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable(),
    icon: z.string().trim().max(40).nullable(),
    is_published: z.boolean().default(true),
    order_index: z.number().int().min(0).max(999).nullable(),
  }),
  fields: [
    { key: "title", label: "Title", type: "text", required: true, max: 120 },
    { key: "description", label: "Description", type: "textarea", rows: 3, max: 1000 },
    { key: "icon", label: "Icon name", type: "text", placeholder: "GraduationCap", max: 40 },
    { key: "order_index", label: "Display order", type: "number" },
    { key: "is_published", label: "Published", type: "switch" },
  ],
  columns: [
    { key: "title", label: "Title" },
    { key: "icon", label: "Icon" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
  ],
  orderBy: { column: "order_index", ascending: true },
  defaultValues: { is_published: true },
};

const facilitiesConfig: CrudConfig<{
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  icon: string | null;
  is_published: boolean | null;
  order_index: number | null;
}> = {
  table: "school_facilities",
  title: "Facilities",
  emptyHint:
    "No facilities yet. Add labs, libraries, sports fields and dorms to show on the public site.",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1500).nullable(),
    image_url: z
      .string()
      .trim()
      .url()
      .nullable()
      .or(z.literal("").transform(() => null)),
    icon: z.string().trim().max(40).nullable(),
    is_published: z.boolean().default(true),
    order_index: z.number().int().min(0).max(999).nullable(),
  }),
  fields: [
    { key: "name", label: "Name", type: "text", required: true, max: 120 },
    { key: "description", label: "Description", type: "textarea", rows: 3, max: 1500 },
    { key: "image_url", label: "Image URL", type: "url", placeholder: "https://" },
    { key: "icon", label: "Icon name", type: "text", placeholder: "FlaskConical", max: 40 },
    { key: "order_index", label: "Display order", type: "number" },
    { key: "is_published", label: "Published", type: "switch" },
  ],
  columns: [
    { key: "name", label: "Name" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
  ],
  orderBy: { column: "order_index", ascending: true },
  defaultValues: { is_published: true },
};

const sportsConfig: CrudConfig<{
  id: string;
  sport_name: string;
  sport_category: string | null;
  gender_category: string | null;
  age_groups: string | null;
  coach_name: string | null;
  coach_qualification: string | null;
  training_days: string | null;
  training_time: string | null;
  achievements: string | null;
  facilities_description: string | null;
  is_active: boolean | null;
  order_index: number | null;
}> = {
  table: "school_sports",
  title: "Sports & coaching",
  emptyHint: "No sports yet. Add disciplines you coach so they appear on the public site.",
  schema: z.object({
    sport_name: z.string().trim().min(1).max(120),
    sport_category: z.string().trim().max(60).nullable(),
    gender_category: z.enum(["male", "female", "mixed"]).default("mixed"),
    age_groups: z.string().trim().max(120).nullable(),
    coach_name: z.string().trim().max(120).nullable(),
    coach_qualification: z.string().trim().max(200).nullable(),
    training_days: z.string().trim().max(120).nullable(),
    training_time: z.string().trim().max(60).nullable(),
    achievements: z.string().trim().max(1500).nullable(),
    facilities_description: z.string().trim().max(1500).nullable(),
    is_active: z.boolean().default(true),
    order_index: z.number().int().min(0).max(999).nullable(),
  }),
  fields: [
    { key: "sport_name", label: "Sport name", type: "text", required: true, max: 120 },
    {
      key: "sport_category",
      label: "Category",
      type: "select",
      options: [
        { value: "Team sport", label: "Team sport" },
        { value: "Individual", label: "Individual" },
        { value: "Athletics", label: "Athletics" },
        { value: "Water", label: "Water" },
        { value: "Martial arts", label: "Martial arts" },
        { value: "Other", label: "Other" },
      ],
    },
    {
      key: "gender_category",
      label: "Gender",
      type: "select",
      options: [
        { value: "mixed", label: "Mixed" },
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
      ],
    },
    {
      key: "age_groups",
      label: "Age groups",
      type: "text",
      placeholder: "U12, U15, U18",
      max: 120,
    },
    { key: "coach_name", label: "Coach name", type: "text", max: 120 },
    { key: "coach_qualification", label: "Coach qualification", type: "text", max: 200 },
    {
      key: "training_days",
      label: "Training days",
      type: "text",
      placeholder: "Mon, Wed, Fri",
      max: 120,
    },
    {
      key: "training_time",
      label: "Training time",
      type: "text",
      placeholder: "4:00 PM – 6:00 PM",
      max: 60,
    },
    { key: "facilities_description", label: "Facilities", type: "textarea", rows: 2, max: 1500 },
    { key: "achievements", label: "Achievements", type: "textarea", rows: 2, max: 1500 },
    { key: "order_index", label: "Display order", type: "number" },
    { key: "is_active", label: "Active", type: "switch", hint: "Visible on the public site" },
  ],
  columns: [
    { key: "sport_name", label: "Sport" },
    { key: "sport_category", label: "Category" },
    { key: "coach_name", label: "Coach" },
    { key: "is_active", label: "Active", render: (r) => (r.is_active ? "Yes" : "No") },
  ],
  orderBy: { column: "order_index", ascending: true },
  defaultValues: { is_active: true, gender_category: "mixed" },
};

const staffConfig: CrudConfig<{
  id: string;
  full_name: string;
  role: string | null;
  avatar_url: string | null;
  bio: string | null;
  subject_specialty: string | null;
  qualification: string | null;
  years_experience: number | null;
  order_index: number | null;
  is_published: boolean | null;
}> = {
  table: "school_staff",
  title: "Public site staff",
  emptyHint:
    "No staff cards yet. Add teachers, principals and admins with a photo and bio to feature them on your public site.",
  schema: z.object({
    full_name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(80).nullable(),
    avatar_url: z
      .string()
      .trim()
      .url()
      .nullable()
      .or(z.literal("").transform(() => null)),
    bio: z.string().trim().max(2000).nullable(),
    subject_specialty: z.string().trim().max(120).nullable(),
    qualification: z.string().trim().max(120).nullable(),
    years_experience: z.number().int().min(0).max(80).nullable(),
    order_index: z.number().int().min(0).max(999).nullable(),
    is_published: z.boolean().default(true),
  }),
  fields: [
    { key: "full_name", label: "Full name", type: "text", required: true, max: 120 },
    {
      key: "role",
      label: "Role",
      type: "select",
      options: [
        { value: "teacher", label: "Teacher" },
        { value: "principal", label: "Principal" },
        { value: "admin", label: "Admin" },
        { value: "coach", label: "Coach" },
        { value: "counsellor", label: "Counsellor" },
        { value: "staff", label: "Staff" },
      ],
    },
    {
      key: "avatar_url",
      label: "Photo",
      type: "image",
      hint: "Upload a portrait photo (JPG/PNG, up to 8 MB).",
    },
    {
      key: "bio",
      label: "Bio",
      type: "textarea",
      rows: 4,
      max: 2000,
      placeholder: "Short introduction shown beneath the photo",
    },
    { key: "subject_specialty", label: "Subject specialty", type: "text", max: 120 },
    { key: "qualification", label: "Qualification", type: "text", max: 120 },
    { key: "years_experience", label: "Years of experience", type: "number" },
    { key: "order_index", label: "Display order", type: "number" },
    { key: "is_published", label: "Published", type: "switch" },
  ],
  columns: [
    { key: "full_name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "subject_specialty", label: "Subject" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
  ],
  orderBy: { column: "order_index", ascending: true },
  defaultValues: { is_published: true },
};

const galleryConfig: CrudConfig<{
  id: string;
  title: string | null;
  caption: string | null;
  image_url: string;
  order_index: number | null;
  is_published: boolean | null;
}> = {
  table: "school_gallery",
  title: "Gallery",
  emptyHint: "No photos yet. Upload gallery images to show life at your school.",
  schema: z.object({
    title: z.string().trim().max(120).nullable(),
    caption: z.string().trim().max(300).nullable(),
    image_url: z.string().trim().url("A public image URL is required"),
    order_index: z.number().int().min(0).max(999).nullable(),
    is_published: z.boolean().default(true),
  }),
  fields: [
    {
      key: "image_url",
      label: "Photo",
      type: "image",
      required: true,
      hint: "Upload a gallery photo (JPG/PNG, up to 8 MB).",
    },
    { key: "title", label: "Title", type: "text", max: 120 },
    { key: "caption", label: "Caption", type: "textarea", rows: 2, max: 300 },
    { key: "order_index", label: "Display order", type: "number" },
    { key: "is_published", label: "Published", type: "switch" },
  ],
  columns: [
    { key: "title", label: "Title" },
    { key: "caption", label: "Caption" },
    { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
  ],
  orderBy: { column: "order_index", ascending: true },
  defaultValues: { is_published: true },
};

function CmsPage() {
  return (
    <PortalPage
      title="Public website CMS"
      subtitle="Edit the content sections that render on your school's public site."
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back to dashboard
        </Link>
        <Link
          to="/admin/settings"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          School settings
        </Link>
      </div>

      <CmsTabs />
    </PortalPage>
  );
}

const TAB_ITEMS: Array<{ value: string; label: string }> = [
  { value: "programs", label: "Programs" },
  { value: "facilities", label: "Facilities" },
  { value: "sports", label: "Sports" },
  { value: "meals", label: "Meals" },
  { value: "transport", label: "Transport" },
  { value: "staff", label: "Staff" },
  { value: "gallery", label: "Gallery" },
  { value: "news", label: "News" },
  { value: "events", label: "Events" },
  { value: "blog", label: "Blog" },
  { value: "testimonials", label: "Testimonials" },
  { value: "faqs", label: "FAQs" },
  { value: "why", label: "Why us" },
];

function CmsTabs() {
  const { profile } = useApp();
  const [tab, setTab] = useState<string>("programs");

  const blogConfig: CrudConfig<{
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    content: string;
    category: string | null;
    cover_image_url: string | null;
    is_published: boolean | null;
    published_at: string | null;
  }> = {
    table: "blog_posts",
    title: "Blog",
    emptyHint: "No blog posts yet. Publish stories from your school to populate the Blog section.",
    schema: z.object({
      title: z.string().trim().min(1).max(200),
      slug: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and dashes only"),
      excerpt: z.string().trim().max(400).nullable(),
      content: z.string().trim().min(1).max(40000),
      category: z.string().trim().max(60).nullable(),
      cover_image_url: z
        .string()
        .trim()
        .url()
        .nullable()
        .or(z.literal("").transform(() => null)),
      is_published: z.boolean().default(true),
    }),
    fields: [
      { key: "title", label: "Title", type: "text", required: true, max: 200 },
      {
        key: "slug",
        label: "Slug (URL)",
        type: "text",
        required: true,
        max: 160,
        placeholder: "welcome-to-our-school",
      },
      { key: "excerpt", label: "Excerpt", type: "textarea", rows: 2, max: 400 },
      {
        key: "content",
        label: "Content (Markdown allowed)",
        type: "textarea",
        rows: 10,
        max: 40000,
        required: true,
      },
      { key: "category", label: "Category", type: "text", max: 60 },
      { key: "cover_image_url", label: "Cover image URL", type: "url" },
      { key: "is_published", label: "Published", type: "switch" },
    ],
    columns: [
      { key: "title", label: "Title" },
      { key: "category", label: "Category" },
      { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
      {
        key: "published_at",
        label: "Date",
        render: (r) => (r.published_at ? new Date(r.published_at).toLocaleDateString() : "—"),
      },
    ],
    orderBy: { column: "published_at", ascending: false },
    defaultValues: { is_published: true },
    extraInsertPayload: profile
      ? { author_id: profile.id, published_at: new Date().toISOString() }
      : undefined,
  };

  const eventsConfig: CrudConfig<{
    id: string;
    title: string;
    description: string | null;
    event_date: string;
    event_time: string | null;
    location: string | null;
    event_type: string | null;
    cover_image_url: string | null;
    is_published: boolean | null;
  }> = {
    table: "events",
    title: "Events",
    emptyHint: "No events yet. Publish upcoming events so they appear in the News & Events feed.",
    schema: z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(4000).nullable(),
      event_date: z.string().min(8),
      event_time: z.string().nullable().optional(),
      location: z.string().trim().max(180).nullable(),
      event_type: z.string().trim().max(60).nullable(),
      cover_image_url: z
        .string()
        .trim()
        .url()
        .nullable()
        .or(z.literal("").transform(() => null)),
      is_published: z.boolean().default(true),
    }),
    fields: [
      { key: "title", label: "Title", type: "text", required: true, max: 200 },
      { key: "description", label: "Description", type: "textarea", rows: 4, max: 4000 },
      { key: "event_date", label: "Date", type: "date", required: true },
      { key: "event_time", label: "Time", type: "time" },
      { key: "location", label: "Location", type: "text", max: 180 },
      {
        key: "event_type",
        label: "Type",
        type: "select",
        options: [
          { value: "open_house", label: "Open house" },
          { value: "sports", label: "Sports" },
          { value: "academic", label: "Academic" },
          { value: "cultural", label: "Cultural" },
          { value: "meeting", label: "Meeting" },
          { value: "other", label: "Other" },
        ],
      },
      { key: "cover_image_url", label: "Cover image URL", type: "url" },
      { key: "is_published", label: "Published", type: "switch" },
    ],
    columns: [
      { key: "event_date", label: "Date" },
      { key: "title", label: "Title" },
      { key: "location", label: "Location", render: (r) => r.location ?? "—" },
      { key: "is_published", label: "Published", render: (r) => (r.is_published ? "Yes" : "No") },
    ],
    orderBy: { column: "event_date", ascending: true },
    defaultValues: { is_published: true },
    extraInsertPayload: profile ? { created_by: profile.id } : undefined,
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      {/* Mobile: native select — no overflow, no overlap */}
      <div className="md:hidden mb-4">
        <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
          Section
        </label>
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-medium"
        >
          {TAB_ITEMS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: full tab strip */}
      <TabsList className="hidden md:flex w-full flex-wrap h-auto gap-1">
        <TabsTrigger value="programs">Programs</TabsTrigger>
        <TabsTrigger value="facilities">Facilities</TabsTrigger>
        <TabsTrigger value="sports">Sports</TabsTrigger>
        <TabsTrigger value="meals">Meals</TabsTrigger>
        <TabsTrigger value="transport">Transport</TabsTrigger>
        <TabsTrigger value="staff">Staff</TabsTrigger>
        <TabsTrigger value="gallery">Gallery</TabsTrigger>
        <TabsTrigger value="news">News</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
        <TabsTrigger value="blog">Blog</TabsTrigger>
        <TabsTrigger value="testimonials">Testimonials</TabsTrigger>
        <TabsTrigger value="faqs">FAQs</TabsTrigger>
        <TabsTrigger value="why">Why us</TabsTrigger>
      </TabsList>
      <TabsContent value="programs" className="mt-6">
        <CrudList config={programsConfig} />
      </TabsContent>
      <TabsContent value="facilities" className="mt-6">
        <CrudList config={facilitiesConfig} />
      </TabsContent>
      <TabsContent value="sports" className="mt-6">
        <CrudList config={sportsConfig} />
      </TabsContent>
      <TabsContent value="meals" className="mt-6">
        <MealsTab />
      </TabsContent>
      <TabsContent value="transport" className="mt-6">
        <TransportTab />
      </TabsContent>
      <TabsContent value="staff" className="mt-6">
        <CrudList config={staffConfig} />
      </TabsContent>
      <TabsContent value="gallery" className="mt-6">
        <CrudList config={galleryConfig} />
      </TabsContent>
      <TabsContent value="news" className="mt-6">
        <CrudList config={newsConfig} />
      </TabsContent>
      <TabsContent value="events" className="mt-6">
        <CrudList config={eventsConfig} />
      </TabsContent>
      <TabsContent value="blog" className="mt-6">
        <CrudList config={blogConfig} />
      </TabsContent>
      <TabsContent value="testimonials" className="mt-6">
        <CrudList config={testimonialsConfig} />
      </TabsContent>
      <TabsContent value="faqs" className="mt-6">
        <CrudList config={faqsConfig} />
      </TabsContent>
      <TabsContent value="why" className="mt-6">
        <CrudList config={whyUsConfig} />
      </TabsContent>
    </Tabs>
  );
}
