import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

export const Route = createFileRoute("/blog/$slug")({
  component: BlogDetail,
});

type BlogRow = {
  id: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_image_url: string | null;
  published_at: string | null;
  category: string | null;
  slug: string;
};

function BlogDetail() {
  const { slug } = Route.useParams();
  const { school, loading } = useApp();

  const post = useQuery<BlogRow | null>({
    queryKey: ["public-blog-detail", school?.id, slug],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id,title,excerpt,content,cover_image_url,published_at,category,slug")
        .eq("school_id", school!.id)
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as BlogRow | null;
    },
  });

  useEffect(() => {
    if (!post.data || !school) return;
    const title = `${post.data.title} — ${school.name}`;
    const prev = document.title;
    document.title = title;
    const desc = (post.data.excerpt ?? post.data.content ?? "").slice(0, 280);
    const tags: Array<[string, string, string]> = [
      ["name", "description", desc],
      ["property", "og:title", post.data.title],
      ["property", "og:description", desc],
      ["property", "og:type", "article"],
      ["property", "og:url", window.location.href],
    ];
    if (post.data.cover_image_url) {
      tags.push(["property", "og:image", post.data.cover_image_url]);
      tags.push(["name", "twitter:image", post.data.cover_image_url]);
    }
    const created: HTMLMetaElement[] = [];
    tags.forEach(([attr, key, val]) => {
      const t = document.createElement("meta");
      t.setAttribute(attr, key);
      t.setAttribute("content", val);
      document.head.appendChild(t);
      created.push(t);
    });
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = window.location.href;
    document.head.appendChild(canonical);

    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.data.title,
      datePublished: post.data.published_at,
      image: post.data.cover_image_url ?? undefined,
      publisher: { "@type": "EducationalOrganization", name: school.name },
      description: desc,
      mainEntityOfPage: window.location.href,
    });
    document.head.appendChild(ld);
    return () => {
      document.title = prev;
      created.forEach((t) => t.remove());
      canonical.remove();
      ld.remove();
    };
  }, [post.data, school]);

  if (loading || post.isLoading) return <Shell>Loading…</Shell>;
  if (!school) return <Shell>Open this page from a school site.</Shell>;
  if (!post.data)
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold">Post not found</h1>
        <Link to="/" className="mt-4 inline-block text-[var(--tenant-primary)] underline">
          ← Back to {school.name}
        </Link>
      </Shell>
    );

  const p = post.data;
  return (
    <Shell>
      <Link to="/" className="text-xs uppercase tracking-widest text-slate-400 hover:text-white">
        ← {school.name}
      </Link>
      {p.category && (
        <div className="mt-6 text-[11px] uppercase tracking-widest text-[var(--tenant-primary)] font-bold">
          {p.category}
        </div>
      )}
      <h1 className="mt-2 font-display text-3xl md:text-5xl font-extrabold">{p.title}</h1>
      {p.published_at && (
        <p className="mt-3 text-sm text-slate-500">
          {new Date(p.published_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      )}
      {p.cover_image_url && (
        <img
          src={p.cover_image_url}
          alt={p.title}
          className="mt-8 w-full rounded-2xl object-cover"
        />
      )}
      {p.excerpt && <p className="mt-8 text-lg text-slate-300 leading-relaxed">{p.excerpt}</p>}
      <div className="mt-6 whitespace-pre-wrap text-slate-200 leading-relaxed">{p.content}</div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-dvh text-white"
      style={{ background: "linear-gradient(180deg, #0a0f1e 0%, #0d1424 100%)" }}
    >
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">{children}</article>
    </div>
  );
}
