/** Generic schema-driven form for one block (SPEC §7): renders FieldDefs; localized fields edit the active locale. */
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FieldDef } from "@/lib/website/catalog";
import type { Locale, Localized } from "@/lib/website/types";

type Props = {
  fields: FieldDef[];
  value: Record<string, unknown>;
  locale: Locale;
  onChange: (key: string, v: unknown, localized: boolean) => void;
};

const cls = "w-full rounded-md border bg-background p-2 text-sm";

function Single({
  f,
  v,
  locale,
  onChange,
}: {
  f: FieldDef;
  v: unknown;
  locale: Locale;
  onChange: (v: unknown) => void;
}) {
  const text = f.localized
    ? ((v as Localized | undefined)?.[locale] ?? "")
    : typeof v === "string"
      ? v
      : "";
  const id = `f-${f.key}`;
  switch (f.type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v === true}
            onChange={(e) => onChange(e.target.checked || undefined)}
          />{" "}
          {f.label}
        </label>
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={typeof v === "number" ? String(v) : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "select":
      return (
        <select
          id={id}
          className={cls}
          value={typeof v === "string" ? v : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Default</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "textarea":
    case "richtext":
      return (
        <Textarea
          id={id}
          rows={f.type === "richtext" ? 6 : 3}
          maxLength={f.max}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          id={id}
          type={f.type === "url" || f.type === "image" ? "url" : "text"}
          maxLength={f.max}
          placeholder={f.type === "image" ? "https://… (image link)" : undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function FieldEditor({ fields, value, locale, onChange }: Props) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          {f.type !== "boolean" ? (
            <label htmlFor={`f-${f.key}`} className="text-xs font-medium text-muted-foreground">
              {f.label}
              {f.localized ? ` (${locale})` : ""}
            </label>
          ) : null}
          {f.type === "list" ? (
            <ListField
              f={f}
              items={Array.isArray(value[f.key]) ? (value[f.key] as Record<string, unknown>[]) : []}
              locale={locale}
              onChange={(v) => onChange(f.key, v, false)}
            />
          ) : (
            <Single
              f={f}
              v={value[f.key]}
              locale={locale}
              onChange={(v) => onChange(f.key, v, !!f.localized)}
            />
          )}
          {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ListField({
  f,
  items,
  locale,
  onChange,
}: {
  f: FieldDef;
  items: Record<string, unknown>[];
  locale: Locale;
  onChange: (v: Record<string, unknown>[]) => void;
}) {
  const sub = f.item ?? [];
  const set = (i: number, key: string, v: unknown, localized: boolean) => {
    const next = items.map((x) => ({ ...x }));
    if (localized) {
      const cur = { ...((next[i][key] as Localized | undefined) ?? {}) };
      if (typeof v === "string" && v) cur[locale] = v;
      else delete cur[locale];
      next[i][key] = cur;
    } else if (v === undefined || v === "") delete next[i][key];
    else next[i][key] = v;
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded-md border p-2 space-y-2">
          <FieldEditor
            fields={sub}
            value={it}
            locale={locale}
            onChange={(k, v, l) => set(i, k, v, l)}
          />
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              className="underline"
              disabled={i === 0}
              onClick={() => {
                const n = items.slice();
                [n[i - 1], n[i]] = [n[i], n[i - 1]];
                onChange(n);
              }}
            >
              Move up
            </button>
            <button
              type="button"
              className="underline text-destructive"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      {items.length < (f.max ?? 24) ? (
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs"
          onClick={() => onChange([...items, {}])}
        >
          Add item
        </button>
      ) : null}
    </div>
  );
}
