/**
 * Read-only published news feed for teacher / student / parent portals.
 * Tracks per-user reads and shows an "Unread" badge for never-seen items.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, Pin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { useReadNewsIds, useMarkNewsRead } from "@/lib/news-reads";

type NewsRow = {
  id: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  category: string | null;
  cover_image_url: string | null;
  is_pinned: boolean | null;
  published_at: string | null;
  created_at: string;
};

export function NewsList() {
  const { school } = useApp();
  const q = useQuery<NewsRow[]>({
    queryKey: ["news-read", school?.id],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news")
        .select(
          "id,title,excerpt,content,category,cover_image_url,is_pinned,published_at,created_at",
        )
        .eq("school_id", school!.id)
        .eq("is_published", true)
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as NewsRow[];
    },
  });

  const reads = useReadNewsIds();
  const readSet = reads.data ?? new Set<string>();

  const rows = q.data ?? [];
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  useMarkNewsRead(ids);

  if (q.isLoading) {
    return (
      <div className="uos-card p-8 text-center text-sm text-muted-foreground">Loading news…</div>
    );
  }
  if (q.error) {
    return (
      <div className="uos-card p-8 text-center text-sm text-red-400">
        {(q.error as Error).message}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="uos-empty p-10 text-center">
        <Newspaper className="mx-auto size-10 text-muted-foreground/60" />
        <h3 className="mt-3 font-display text-lg font-semibold">No announcements yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          School news and announcements will appear here once published.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((n) => {
        const unread = !readSet.has(n.id);
        return (
          <article key={n.id} className="uos-card overflow-hidden relative">
            {unread && (
              <span className="absolute right-3 top-3 z-10 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                New
              </span>
            )}
            {n.cover_image_url && (
              <img
                src={n.cover_image_url}
                alt=""
                width={640}
                height={160}
                loading="lazy"
                decoding="async"
                className="w-full h-40 object-cover"
              />
            )}
            <div className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {n.is_pinned && (
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <Pin className="size-3" /> Pinned
                  </span>
                )}
                {n.category && (
                  <span className="px-2 py-0.5 rounded border border-border uppercase tracking-wide">
                    {n.category}
                  </span>
                )}
                <span>
                  {new Date(n.published_at ?? n.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
              <h2 className="mt-2 font-display text-lg font-semibold">{n.title}</h2>
              {n.excerpt && <p className="mt-1 text-sm text-muted-foreground">{n.excerpt}</p>}
              {n.content && !n.excerpt && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{n.content}</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
