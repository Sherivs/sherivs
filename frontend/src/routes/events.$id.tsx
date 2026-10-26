import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PublicContentShell } from "@/components/public/policy-shell";

export const Route = createFileRoute("/events/$id")({
  component: EventDetail,
});

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_date: string;
  end_date: string | null;
  event_time: string | null;
  end_time: string | null;
  event_type: string | null;
  cover_image_url: string | null;
};

function EventDetail() {
  const { id } = Route.useParams();
  const { school, loading } = useApp();

  const ev = useQuery<EventRow | null>({
    queryKey: ["public-event-detail", school?.id, id],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(
          "id,title,description,location,event_date,end_date,event_time,end_time,event_type,cover_image_url",
        )
        .eq("school_id", school!.id)
        .eq("id", id)
        .eq("is_published", true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as EventRow | null;
    },
  });

  useEffect(() => {
    if (!ev.data || !school) return;
    const title = `${ev.data.title} — ${school.name}`;
    const prev = document.title;
    document.title = title;
    const desc = (ev.data.description ?? "").slice(0, 280);
    const startISO = ev.data.event_time
      ? `${ev.data.event_date}T${ev.data.event_time}`
      : ev.data.event_date;
    const endISO =
      ev.data.end_date && ev.data.end_time
        ? `${ev.data.end_date}T${ev.data.end_time}`
        : (ev.data.end_date ?? undefined);

    const tags: Array<[string, string, string]> = [
      ["name", "description", desc],
      ["property", "og:title", ev.data.title],
      ["property", "og:description", desc],
      ["property", "og:type", "event"],
      ["property", "og:url", window.location.href],
    ];
    if (ev.data.cover_image_url) {
      tags.push(["property", "og:image", ev.data.cover_image_url]);
      tags.push(["name", "twitter:image", ev.data.cover_image_url]);
    }
    const created: HTMLMetaElement[] = [];
    tags.forEach(([attr, key, val]) => {
      const t = document.createElement("meta");
      t.setAttribute(attr, key);
      t.setAttribute("content", val);
      document.head.appendChild(t);
      created.push(t);
    });
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Event",
      name: ev.data.title,
      description: desc,
      startDate: startISO,
      endDate: endISO,
      image: ev.data.cover_image_url ?? undefined,
      location: ev.data.location ? { "@type": "Place", name: ev.data.location } : undefined,
      organizer: { "@type": "EducationalOrganization", name: school.name },
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    });
    document.head.appendChild(ld);
    return () => {
      document.title = prev;
      created.forEach((t) => t.remove());
      ld.remove();
    };
  }, [ev.data, school]);

  if (loading || ev.isLoading) return <PublicContentShell>Loading…</PublicContentShell>;
  if (!school) return <PublicContentShell>Open this page from a school site.</PublicContentShell>;
  if (!ev.data)
    return (
      <PublicContentShell>
        <h1 className="font-display text-2xl font-bold">Event not found</h1>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          ← Back to {school.name}
        </Link>
      </PublicContentShell>
    );

  const e = ev.data;
  return (
    <PublicContentShell>
      <Link to="/" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
        ← {school.name}
      </Link>
      <div className="mt-6 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        {e.event_type ?? "Event"}
      </div>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-5xl">{e.title}</h1>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          {new Date(e.event_date).toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          {e.event_time ? ` · ${e.event_time.slice(0, 5)}` : ""}
        </span>
        {e.location && <span>· {e.location}</span>}
      </div>
      {e.cover_image_url && (
        <img
          src={e.cover_image_url}
          alt={e.title}
          className="mt-8 w-full rounded-2xl object-cover"
        />
      )}
      {e.description && (
        <div className="mt-8 whitespace-pre-wrap leading-relaxed">{e.description}</div>
      )}
    </PublicContentShell>
  );
}
