import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PortalPage } from "@/components/portal-shell";
import { RoleGuard } from "@/components/role-guard";
import { getOrganizationProfile, saveOrganizationProfile } from "@/lib/runtime/scholar/org-profile.functions";
import { recommendTemplates } from "@/lib/onboarding/template-engine";
import {
  SCHOLAR_SCHOOL_TEMPLATES,
  SCHOLAR_TEMPLATE_FEATURES,
  type TemplateFeature,
} from "@/lib/runtime/scholar-school-templates";
import {
  DAY_PRESETS,
  recommendDayRoutines,
  type AcademicWindow,
} from "@/lib/scholar/day-recommendation";

type ClosingPreset = keyof typeof DAY_PRESETS;

const CLOSING_OPTIONS: ReadonlyArray<{ value: ClosingPreset; label: string }> = [
  { value: "halfDay_12", label: "Closes 12:00" },
  { value: "halfDay_13", label: "Closes 13:00" },
  { value: "early_14", label: "Closes 14:00" },
  { value: "fullDay_17", label: "Closes 17:00" },
  { value: "extended_18", label: "Closes 18:00" },
];

export const Route = createFileRoute("/_authenticated/admin/school-profile")({
  ssr: false,
  component: () => (
    <RoleGuard allow={["admin", "principal"]}>
      <SchoolProfilePage />
    </RoleGuard>
  ),
});

function SchoolProfilePage() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [closing, setClosing] = useState<ClosingPreset>("fullDay_17");
  const qc = useQueryClient();
  const getProfile = useServerFn(getOrganizationProfile);
  const saveProfile = useServerFn(saveOrganizationProfile);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const profileApplied = useRef(false);

  const profileQuery = useQuery({
    queryKey: ["org-school-profile"],
    queryFn: async () => getProfile({ data: {} }),
  });

  useEffect(() => {
    if (profileQuery.data && !profileApplied.current) {
      setSelected(new Set(profileQuery.data.payload.features));
      setClosing(profileQuery.data.payload.closingPreset);
      profileApplied.current = true;
    }
  }, [profileQuery.data]);

  async function handleSave() {
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await saveProfile({
        data: {
          profile: {
            version: 1,
            features: [...selected],
            closingPreset: closing,
          },
        },
      });
      setProfileMsg("Saved — this profile will drive every surface for your school.");
      qc.invalidateQueries({ queryKey: ["org-school-profile"] });
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setProfileBusy(false);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, TemplateFeature[]>();
    for (const feature of SCHOLAR_TEMPLATE_FEATURES) {
      const list = map.get(feature.group);
      if (list) list.push(feature);
      else map.set(feature.group, [feature]);
    }
    return [...map.entries()];
  }, []);

  const recommendations = useMemo(
    () => recommendTemplates(SCHOLAR_SCHOOL_TEMPLATES, selected),
    [selected],
  );
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const doubleShift = selected.has("schedule.double_shift");
  const boarding = selected.has("schedule.boarding");

  const dayWindows = useMemo<AcademicWindow[]>(() => {
    const base = DAY_PRESETS[closing];
    if (!doubleShift) return [base];
    // Suggested morning + afternoon sessions for a double-shift school.
    return [base, { open: "13:00", close: "18:00" }];
  }, [closing, doubleShift]);

  const dayRecommendation = useMemo(
    () =>
      recommendDayRoutines({
        name: "School day",
        windows: dayWindows,
        boardingPrep: boarding ? { open: "18:00", close: "20:30" } : null,
      }),
    [dayWindows, boarding],
  );

  return (
    <PortalPage
      title="School profile & templates"
      subtitle="Tell Sherivs what your school actually does — nothing is forced. Matching templates are suggested and you keep full control of every feature."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="uos-card p-5">
          <h2 className="mb-1 font-display text-base font-semibold">What does your school run?</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Tick every box that applies. Sherivs adapts to you — religious, vocational, boarding,
            double-shift, multi-campus and everything between.
          </p>
          {groups.map(([group, features]) => (
            <fieldset key={group} className="mb-4">
              <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {group}
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {features.map((feature) => (
                  <label
                    key={feature.key}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(feature.key)}
                      onChange={() => toggle(feature.key)}
                      className="size-3.5 accent-primary"
                    />
                    {feature.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear all selections
            </button>
          )}
        </section>

        <section className="uos-card p-5">
          <h2 className="mb-1 font-display text-base font-semibold">Recommended templates</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Best matches appear first. A template is only a suggestion — adopt it as a starting
            point and change anything afterwards.
          </p>
          {recommendations.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              {selected.size === 0
                ? "Select at least one feature above to see template suggestions."
                : "No template matches those choices — that is fine. Sherivs still supports your school; you simply keep your own mix."}
            </p>
          ) : (
            <ul className="space-y-2">
              {recommendations.map(({ template, matchedKeys, uncoveredKeys }) => (
                <li key={template.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{template.title}</div>
                    <span className="shrink-0 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {matchedKeys} match{matchedKeys === 1 ? "" : "es"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                  {uncoveredKeys.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      Your other choices ({uncoveredKeys.length}) stay on — nothing is removed.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="uos-card mt-5 p-5">
        <h2 className="font-display text-base font-semibold">Your school day (preview)</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Pick your closing time — double-shift and boarding add their sessions automatically from
          the features you selected above.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="closing-preset">
            Closing time
          </label>
          <select
            id="closing-preset"
            value={closing}
            onChange={(e) => setClosing(e.target.value as ClosingPreset)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            {CLOSING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {doubleShift && (
            <span className="rounded-full bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
              Double shift on
            </span>
          )}
          {boarding && (
            <span className="rounded-full bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
              Boarding evening study on
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            disabled={profileBusy}
            onClick={() => void handleSave()}
            className="rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {profileBusy ? "Saving…" : "Save school profile"}
          </button>
          {profileMsg && (
            <span
              className={
                profileMsg.startsWith("Saved")
                  ? "text-[11px] text-emerald-600 dark:text-emerald-400"
                  : "text-[11px] text-destructive"
              }
            >
              {profileMsg}
            </span>
          )}
          {profileQuery.data && (
            <span className="text-[10px] text-muted-foreground">
              Loaded from a previous save — keep editing and save again.
            </span>
          )}
        </div>

        {dayRecommendation.routines.length > 0 ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {dayRecommendation.routines.map((routine) => (
              <li key={routine.name} className="rounded-lg border border-border p-3">
                <div className="text-sm font-medium">{routine.name}</div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {routine.open} → {routine.close}
                </div>
                {routine.blocks.map((block, index) => (
                  <div key={index} className="mt-1 text-[11px] text-muted-foreground">
                    {block.label ?? block.kind}: {block.start} → {block.end}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-destructive">
            The selected day is invalid: {dayRecommendation.issues.join("; ") || "no windows yet"}.
          </p>
        )}
      </section>
    </PortalPage>
  );
}
