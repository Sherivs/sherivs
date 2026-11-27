import { useI18n } from "@/i18n/hook";
import { inbox } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSession } from "@/providers/session-provider";
import { ScreenShell } from "@/ui/components";
import { QueryScreen, Row } from "@/workspace/screen-kit";
import { useSchool } from "@/workspace/use-school";

export default function MessagesScreen() {
  const { t } = useI18n();
  const { client } = useSession();
  const { userId, key } = useSchool();
  const q = useCachedQuery(key("inbox"), () => inbox(client, userId ?? ""), [userId]);
  return (
    <ScreenShell>
      <QueryScreen q={q} empty={t("school.messages.empty")}>
        {(rows) =>
          rows.map((message) => (
            <Row
              key={message.id}
              title={`${message.is_read ? "" : t("school.messages.unreadPrefix")}${message.subject ?? t("school.messages.noSubject")}`}
              sub={message.body.slice(0, 90)}
              right={new Date(message.created_at).toLocaleDateString("en-NG")}
            />
          ))
        }
      </QueryScreen>
    </ScreenShell>
  );
}
