import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useI18n } from "@/i18n/hook";
import { Card, ErrorState, PressableRow, PrimaryButton, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { cbtSave, cbtStart, cbtTests, type CbtAttempt } from "@/api/school.client";
import { readCache, useCachedQuery, writeCache } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen } from "@/workspace/screen-kit";
import { palette, spacing } from "@/ui/theme";

/** CBT: list open tests, take one. Answers autosave every 15 s (and are kept locally so a dropped connection loses nothing). */
export default function CbtScreen() {
  const { t } = useI18n();
  const { client } = useSession();
  const { students, key } = useSchool();
  const classIds = [
    ...new Set((students.data ?? []).map((s) => s.class_id).filter((c): c is string => !!c)),
  ];
  const tests = useCachedQuery(
    students.data ? key("cbt-tests") : null,
    () => cbtTests(client, classIds),
    [classIds.join()],
  );
  const [attempt, setAttempt] = useState<CbtAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  const localKey = attempt ? key(`cbt-answers:${attempt.attempt_id}`) : null;

  useEffect(() => {
    if (!attempt || !localKey) return;
    const timer = setInterval(() => {
      seq.current += 1;
      void writeCache(localKey, { answers, seq: seq.current });
      cbtSave(client, attempt.attempt_id, answers, seq.current, false).catch(() => undefined); // offline: local copy kept, next tick retries
    }, 15_000);
    return () => clearInterval(timer);
  }, [attempt, answers, client, localKey]);

  async function start(testId: string) {
    setError(null);
    try {
      const startedAttempt = await cbtStart(client, testId);
      const attemptKey = key(`cbt-answers:${startedAttempt.attempt_id}`);
      const local = attemptKey
        ? await readCache<{ answers: Record<string, number>; seq: number }>(attemptKey)
        : null;
      seq.current = Math.max(startedAttempt.client_seq ?? 0, local?.data.seq ?? 0);
      setAnswers({ ...(startedAttempt.answers ?? {}), ...(local?.data.answers ?? {}) });
      setAttempt(startedAttempt);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t("school.cbt.cannotStart"));
    }
  }

  async function submit() {
    if (!attempt) return;
    try {
      seq.current += 1;
      const result = await cbtSave(client, attempt.attempt_id, answers, seq.current, true);
      setDone(JSON.stringify(result));
      setAttempt(null);
    } catch (caughtError) {
      setError(
        `${caughtError instanceof Error ? caughtError.message : t("school.cbt.submitFailed")} — ${t("school.cbt.savedOnDeviceRetry")}`,
      );
    }
  }

  if (done) {
    return (
      <ScreenShell>
        <View style={{ padding: spacing.lg }}>
          <Card>
            <Text style={{ color: palette.text }}>
              {t("school.cbt.submitted", { payload: done })}
            </Text>
          </Card>
        </View>
      </ScreenShell>
    );
  }

  if (attempt) {
    return (
      <ScreenShell>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ color: palette.textMuted }}>
            {t("school.cbt.deadline", {
              time: new Date(attempt.deadline).toLocaleTimeString("en-NG"),
            })}
          </Text>
          {(attempt.questions ?? []).map((question, index) => (
            <Card key={question.id}>
              <Text style={{ color: palette.text, marginBottom: spacing.sm }}>
                {index + 1}. {question.stem}
              </Text>
              {question.options.map((option, optionIndex) => (
                <Pressable
                  key={optionIndex}
                  onPress={() =>
                    setAnswers((active) => ({ ...active, [question.id]: optionIndex }))
                  }
                  style={{ paddingVertical: 6 }}
                >
                  <Text
                    style={{
                      color: answers[question.id] === optionIndex ? "#F5C451" : palette.text,
                    }}
                  >
                    {answers[question.id] === optionIndex ? "◉" : "○"} {String(option)}
                  </Text>
                </Pressable>
              ))}
            </Card>
          ))}
          {error ? <ErrorState headline={t("school.cbt.notSavedToServer")} detail={error} /> : null}
          <PrimaryButton label={t("school.cbt.submit")} onPress={submit} />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      {error ? <ErrorState headline={t("school.cbt.errorHeadline")} detail={error} /> : null}
      <QueryScreen q={tests} empty={t("school.cbt.empty")}>
        {(rows) =>
          rows.map((test) => (
            <PressableRow
              key={test.id}
              title={test.title}
              subtitle={t("school.cbt.durationAndClose", {
                minutes: test.duration_minutes,
                time: new Date(test.closes_at).toLocaleString("en-NG"),
              })}
              onPress={() => start(test.id)}
            />
          ))
        }
      </QueryScreen>
    </ScreenShell>
  );
}
