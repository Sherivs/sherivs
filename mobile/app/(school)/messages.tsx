import { ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { inbox } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen, Row } from "@/workspace/screen-kit";

export default function MessagesScreen() {
  const { client } = useSession();
  const { userId, key } = useSchool();
  const q = useCachedQuery(key("inbox"), () => inbox(client, userId ?? ""), [userId]);
  return (
    <ScreenShell>
      <QueryScreen q={q} empty="No messages.">
        {(rows) => rows.map((m) => <Row key={m.id} title={`${m.is_read ? "" : "● "}${m.subject ?? "(no subject)"}`} sub={m.body.slice(0, 90)} right={new Date(m.created_at).toLocaleDateString("en-NG")} />)}
      </QueryScreen>
    </ScreenShell>
  );
}
