/**
 * Public blog index. Lists published blog_posts for the tenant in
 * scope with search + category filter. Skeleton grid when empty.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

export const Route = createFileRoute("/blog")({
  component: BlogIndex,
});

type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  category: string | null;
  published_at: string | null;
};

function BlogIndex() {
  const { school, loading } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");

  const posts = useQuery<Post[]>({
    queryKey: ["public-blog-list", school?.id],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, slug, title, excerpt, cover_image_url, category, published_at")
        .eq("school_id", school!.id)
        .eq("is_published", true)
        .order("published_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Post[];
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    (posts.data ?? []).forEach((p) => p.category && set.add(p.category));
    return Array.from(set).sort();
  }, [posts.data]);

  const filtered = useMemo(() => {
    const list = posts.data ?? [];
    const ql = q.trim().toLowerCase();
    return list.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      if (!ql) return true;
      return p.title.toLowerCase().includes(ql) || (p.excerpt ?? "").toLowerCase().includes(ql);
    });
  }, [posts.data, q, cat]);

  return (
    <div
      className="min-h-dvh text-white"
      style={{ background: "linear-gradient(180deg, #0a0f1e 0%, #0d1424 100%)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        {school && (
          <Link
            to="/"
            className="text-xs uppercase tracking-widest text-slate-400 hover:text-white"
          >
            ← {school.name}
          </Link>
        )}
        <h1 className="mt-6 font-display text-4xl md:text-6xl font-extrabold">Blog</h1>
        <p className="mt-3 text-slate-400">Stories, updates and announcements.</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search posts…"
            className="flex-1 min-w-[200px] rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--tenant-primary,#3b82f6)]"
          />
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {loading || posts.isLoading || filtered.length === 0 ? (
            <SkeletonCards />
          ) : (
            filtered.map((p) => <BlogCard key={p.id} post={p} />)
          )}
        </div>
      </div>
    </div>
  );
}

function BlogCard({ post }: { post: Post }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="group block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-[var(--tenant-primary,#3b82f6)]/60"
    >
      {post.cover_image_url ? (
        <img
          src={post.cover_image_url}
          alt={post.title}
          className="h-48 w-full object-cover transition group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-48 items-center justify-center bg-gradient-to-br from-white/5 to-white/0 text-xs uppercase tracking-widest text-slate-500">
          {post.category ?? "Article"}
        </div>
      )}
      <div className="p-5">
        {post.category && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--tenant-primary,#3b82f6)]">
            {post.category}
          </span>
        )}
        <h3 className="mt-2 font-display text-xl font-bold leading-snug">{post.title}</h3>
        {post.excerpt && <p className="mt-2 line-clamp-3 text-sm text-slate-400">{post.excerpt}</p>}
        {post.published_at && (
          <p className="mt-3 text-xs text-slate-500">
            {new Date(post.published_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
      </div>
    </Link>
  );
}

function SkeletonCards() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02]"
        >
          <div className="flex h-48 items-center justify-center">
            <span className="rounded-full bg-[var(--tenant-primary,#3b82f6)]/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--tenant-primary,#3b82f6)]">
              [ BLOG POST ]
            </span>
          </div>
          <div className="space-y-2 p-5">
            <div className="h-3 w-20 rounded bg-white/5" />
            <div className="h-5 w-3/4 rounded bg-white/10" />
            <div className="h-3 w-full rounded bg-white/5" />
            <div className="h-3 w-2/3 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </>
  );
}
