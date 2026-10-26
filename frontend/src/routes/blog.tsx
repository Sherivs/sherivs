/**
 * Public blog index. Lists published blog_posts for the tenant in
 * scope with search + category filter. Skeleton grid when empty.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PublicContentShell } from "@/components/public/policy-shell";

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
    <PublicContentShell wide>
      {school && (
        <Link
          to="/"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← {school.name}
        </Link>
      )}
      <h1 className="mt-6 font-display text-4xl font-bold tracking-tight md:text-5xl">Blog</h1>
      <p className="mt-3 text-muted-foreground">Stories, updates and announcements.</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search posts…"
          className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded-md border border-border bg-background px-4 py-2 text-sm"
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
    </PublicContentShell>
  );
}

function BlogCard({ post }: { post: Post }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="group block overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/60"
    >
      {post.cover_image_url ? (
        <img
          src={post.cover_image_url}
          alt={post.title}
          className="h-48 w-full object-cover transition group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-48 items-center justify-center bg-muted text-xs uppercase tracking-widest text-muted-foreground">
          {post.category ?? "Article"}
        </div>
      )}
      <div className="p-5">
        {post.category && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
            {post.category}
          </span>
        )}
        <h3 className="mt-2 font-display text-xl font-bold leading-snug">{post.title}</h3>
        {post.excerpt && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{post.excerpt}</p>}
        {post.published_at && (
          <p className="mt-3 text-xs text-muted-foreground">
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
          className="overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/20"
        >
          <div className="flex h-48 items-center justify-center">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              [ BLOG POST ]
            </span>
          </div>
          <div className="space-y-2 p-5">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-5 w-3/4 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
        </div>
      ))}
    </>
  );
}
