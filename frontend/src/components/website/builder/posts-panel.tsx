/**
 * Blog posts editor (SHERIVS-101). Authors (website.posts) write and edit their own drafts; website managers
 * (website.manage) also publish, schedule (future date) and unpublish. The database enforces the same rules.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { rpc } from "@/lib/scholar/rpc";
import { slugify } from "@/lib/website/editor";
import { LOCALE_NAMES } from "@/lib/website/i18n";
import type { Locale, Localized } from "@/lib/website/types";
import { postState } from "@/lib/website/posts";

interface PostRow {
  id?: string;
  slug: string;
  title: Localized;
  excerpt?: Localized | null;
  body?: Localized | null;
  category?: string | null;
  cover_url?: string | null;
  author_name?: string | null;
  seo?: { title?: string; description?: string } | null;
  status: "draft" | "published";
  publish_at?: string | null;
  updated_at?: string;
}
const blank = (): PostRow => ({ slug: "", title: {}, status: "draft" });
const cls = "w-full rounded-md border bg-background p-2 text-sm";

export function PostsPanel({ org, locales }: { org: string; locales: Locale[] }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["website-posts", org],
    enabled: !!org,
    queryFn: () =>
      rpc<{ role: "editor" | "author"; posts: PostRow[] }>("website_posts_list", { p_school: org }),
  });
  const [edit, setEdit] = useState<PostRow | null>(null);
  const [locale, setLocale] = useState<Locale>(locales[0] ?? "en");
  const [busy, setBusy] = useState(false);
  const editor = q.data?.role === "editor";

  async function save(status: "draft" | "published") {
    if (!edit) return;
    const slug = edit.slug || slugify(Object.values(edit.title).find(Boolean) ?? "");
    setBusy(true);
    try {
      const id = await rpc<string>("website_post_save", {
        p_school: org,
        p_post: {
          ...edit,
          slug,
          status,
          publish_at: status === "published" ? edit.publish_at || null : null,
        },
      });
      toast.success(status === "published" ? "Post published" : "Draft saved");
      setEdit({ ...edit, id, slug, status });
      await qc.invalidateQueries({ queryKey: ["website-posts", org] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: PostRow) {
    if (!p.id || !confirm("Delete this post?")) return;
    try {
      await rpc("website_post_delete", { p_school: org, p_id: p.id });
      setEdit(null);
      await qc.invalidateQueries({ queryKey: ["website-posts", org] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const loc = (v: Localized | null | undefined) => v?.[locale] ?? "";
  const setLoc = (k: "title" | "excerpt" | "body", v: string) =>
    edit && setEdit({ ...edit, [k]: { ...(edit[k] ?? {}), [locale]: v } });

  if (q.error) return <p className="text-sm text-muted-foreground">{(q.error as Error).message}</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Posts</h3>
          <Button size="sm" onClick={() => setEdit(blank())}>
            New post
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {editor
            ? "You can write, publish and schedule posts."
            : "You can write drafts; a website manager publishes them."}
        </p>
        <ul className="space-y-1">
          {(q.data?.posts ?? []).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full rounded-md border p-2 text-left text-sm hover:bg-accent"
                onClick={() => setEdit(p)}
              >
                <span className="block font-medium">{Object.values(p.title).find(Boolean)}</span>
                <span className="text-xs text-muted-foreground">
                  {postState(p)}
                  {p.publish_at ? ` · ${new Date(p.publish_at).toLocaleDateString("en-GB")}` : ""}
                  {p.category ? ` · ${p.category}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!q.isLoading && !(q.data?.posts ?? []).length ? (
          <p className="text-sm text-muted-foreground">
            No posts yet. Posts appear in the website's news and blog sections once published.
          </p>
        ) : null}
      </section>
      {edit ? (
        <section className="rounded-lg border p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{edit.id ? "Edit post" : "New post"}</h3>
            <span className="rounded-full border px-2 text-xs">{postState(edit)}</span>
            {locales.length > 1 ? (
              <select
                aria-label="Post language"
                className="ml-auto rounded-md border bg-background p-1 text-sm"
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
              >
                {locales.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l]}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <label className="block text-sm">
            Title
            <Input
              value={loc(edit.title)}
              maxLength={200}
              onChange={(e) => setLoc("title", e.target.value)}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-sm">
              Link (/posts/…)
              <Input
                value={edit.slug}
                placeholder={slugify(Object.values(edit.title).find(Boolean) ?? "") || "post-link"}
                onChange={(e) => setEdit({ ...edit, slug: slugify(e.target.value) })}
              />
            </label>
            <label className="block text-sm">
              Category
              <Input
                value={edit.category ?? ""}
                maxLength={40}
                placeholder="e.g. Sports, Academics"
                onChange={(e) => setEdit({ ...edit, category: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Author
              <Input
                value={edit.author_name ?? ""}
                maxLength={80}
                onChange={(e) => setEdit({ ...edit, author_name: e.target.value })}
              />
            </label>
          </div>
          <label className="block text-sm">
            Cover image link
            <Input
              type="url"
              value={edit.cover_url ?? ""}
              placeholder="https://…"
              onChange={(e) => setEdit({ ...edit, cover_url: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Summary
            <Textarea
              value={loc(edit.excerpt)}
              maxLength={600}
              onChange={(e) => setLoc("excerpt", e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Story (paragraphs, - lists, **bold**, [links](https://…))
            <textarea
              className={cls}
              rows={12}
              value={loc(edit.body)}
              onChange={(e) => setLoc("body", e.target.value)}
            />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer">Search engines</summary>
            <div className="mt-2 grid gap-2">
              <Input
                placeholder="Title for search results"
                value={edit.seo?.title ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, seo: { ...(edit.seo ?? {}), title: e.target.value } })
                }
              />
              <Input
                placeholder="Description for search results"
                value={edit.seo?.description ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, seo: { ...(edit.seo ?? {}), description: e.target.value } })
                }
              />
            </div>
          </details>
          {editor ? (
            <label className="block text-sm">
              Publish date (leave empty for now; a future date schedules the post)
              <Input
                type="datetime-local"
                value={edit.publish_at ? edit.publish_at.slice(0, 16) : ""}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    publish_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => save("draft")}>
              {edit.status === "published" ? "Unpublish (save as draft)" : "Save draft"}
            </Button>
            {editor ? (
              <Button disabled={busy} onClick={() => save("published")}>
                {edit.publish_at && new Date(edit.publish_at) > new Date() ? "Schedule" : "Publish"}
              </Button>
            ) : null}
            {edit.id ? (
              <Button variant="ghost" disabled={busy} onClick={() => remove(edit)}>
                Delete
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
