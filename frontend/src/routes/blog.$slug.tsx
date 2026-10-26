import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PublicContentShell } from "@/components/public/policy-shell";

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

  if (loading || post.isLoading) return <PublicContentShell>Loading…</PublicContentShell>;
  if (!school) return <PublicContentShell>Open this page from a school site.</PublicContentShell>;
  if (!post.data)
    return (
      <PublicContentShell>
        <h1 className="font-display text-2xl font-bold">Post not found</h1>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          ← Back to {school.name}
        </Link>
      </PublicContentShell>
    );

  const p = post.data;
  return (
    <PublicContentShell>
      <Link to="/" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
        ← {school.name}
      </Link>
      {p.category && (
        <div className="mt-6 text-[11px] font-bold uppercase tracking-widest text-primary">
          {p.category}
        </div>
      )}
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-5xl">{p.title}</h1>
      {p.published_at && (
        <p className="mt-3 text-sm text-muted-foreground">
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
      {p.excerpt && <p className="mt-8 text-lg leading-relaxed text-muted-foreground">{p.excerpt}</p>}
      <div className="mt-6 whitespace-pre-wrap leading-relaxed">{p.content}</div>
    </PublicContentShell>
  );
}
