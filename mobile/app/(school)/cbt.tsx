import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Card, ErrorState, PressableRow, PrimaryButton, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { cbtSave, cbtStart, cbtTests, type CbtAttempt } from "@/api/school.client";
import { readCache, useCachedQuery, writeCache } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen } from "@/workspace/screen-kit";
import { palette, spacing } from "@/ui/theme";

/** CBT: list open tests, take one. Answers autosave every 15 s (and are kept locally so a dropped connection loses nothing). */
export default function CbtScreen() {
  const { client } = useSession();
  const { students, key } = useSchool();
  const classIds = [...new Set((students.data ?? []).map((s) => s.class_id).filter((c): c is string => !!c))];
  const tests = useCachedQuery(students.data ? key("cbt-tests") : null, () => cbtTests(client, classIds), [classIds.join()]);
  const [attempt, setAttempt] = useState<CbtAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  const localKey = attempt ? key(`cbt-answers:${attempt.attempt_id}`) : null;

  useEffect(() => {
    if (!attempt || !localKey) return;
    const t = setInterval(() => {
      seq.current += 1;
      void writeCache(localKey, { answers, seq: seq.current });
      cbtSave(client, attempt.attempt_id, answers, seq.current, false).catch(() => undefined); // offline: local copy kept, next tick retries
    }, 15_000);
    return () => clearInterval(t);
  }, [attempt, answers, client, localKey]);

  async function start(testId: string) {
    setError(null);
    try {
      const a = await cbtStart(client, testId);
      const k = key(`cbt-answers:${a.attempt_id}`);
      const local = k ? await readCache<{ answers: Record<string, number>; seq: number }>(k) : null;
      seq.current = Math.max(a.client_seq ?? 0, local?.data.seq ?? 0);
      setAnswers({ ...(a.answers ?? {}), ...(local?.data.answers ?? {}) });
      setAttempt(a);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the test"); }
  }
  async function submit() {
    if (!attempt) return;
    try { seq.current += 1; const r = await cbtSave(client, attempt.attempt_id, answers, seq.current, true); setDone(JSON.stringify(r)); setAttempt(null); }
    catch (e) { setError(`${e instanceof Error ? e.message : "Submit failed"} — your answers are saved on this phone; try again when online.`); }
  }

  if (done) return <ScreenShell><View style={{ padding: spacing.lg }}><Card><Text style={{ color: palette.text }}>Submitted. {done}</Text></Card></View></ScreenShell>;
  if (attempt) {
    return (
      <ScreenShell>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ color: palette.textMuted }}>Deadline {new Date(attempt.deadline).toLocaleTimeString("en-NG")}</Text>
          {(attempt.questions ?? []).map((q, i) => (
            <Card key={q.id}>
              <Text style={{ color: palette.text, marginBottom: spacing.sm }}>{i + 1}. {q.stem}</Text>
              {q.options.map((o, oi) => (
                <Pressable key={oi} onPress={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} style={{ paddingVertical: 6 }}>
                  <Text style={{ color: answers[q.id] === oi ? "#F5C451" : palette.text }}>{answers[q.id] === oi ? "◉" : "○"} {String(o)}</Text>
                </Pressable>
              ))}
            </Card>
          ))}
          {error ? <ErrorState headline="Not saved to server yet" detail={error} /> : null}
          <PrimaryButton label="Submit" onPress={submit} />
        </View>
      </ScreenShell>
    );
  }
  return (
    <ScreenShell>
      {error ? <ErrorState headline="CBT" detail={error} /> : null}
      <QueryScreen q={tests} empty="No open tests for your class.">
        {(rows) => rows.map((t) => <PressableRow key={t.id} title={t.title} subtitle={`${t.duration_minutes} min · closes ${new Date(t.closes_at).toLocaleString("en-NG")}`} onPress={() => start(t.id)} />)}
      </QueryScreen>
    </ScreenShell>
  );
}
