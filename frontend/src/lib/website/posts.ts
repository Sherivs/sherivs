/** Blog post helpers shared by the builder and tests (SHERIVS-101). */
export type PostState = "draft" | "scheduled" | "published";
/** Display state: a published post with a future date is "scheduled". */
export function postState(
  p: { status: string; publish_at?: string | null },
  now = new Date(),
): PostState {
  if (p.status !== "published") return "draft";
  return p.publish_at && new Date(p.publish_at) > now ? "scheduled" : "published";
}
