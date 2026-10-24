/** UI strings in English, Hausa, Yoruba, Igbo and Nigerian Pidgin (SHERIVS-025). Server table ui_translations is the source; English is the fallback. */
import { useQuery } from "@tanstack/react-query";
import { rpc } from "./rpc";

export const LOCALES = [{ code: "en", label: "English" }, { code: "ha", label: "Hausa" }, { code: "yo", label: "Yorùbá" }, { code: "ig", label: "Igbo" }, { code: "pcm", label: "Pidgin" }] as const;
export type Locale = (typeof LOCALES)[number]["code"];
const KEY = "sherivs.locale";
export function currentLocale(): Locale { if (typeof localStorage === "undefined") return "en"; const l = localStorage.getItem(KEY); return (LOCALES.some((x) => x.code === l) ? l : "en") as Locale; }
export async function setLocale(l: Locale) { localStorage.setItem(KEY, l); await rpc("set_my_locale", { p_locale: l }).catch(() => {}); }
export function useT(locale: Locale = currentLocale()) {
  const q = useQuery({ queryKey: ["ui-strings", locale], staleTime: 3_600_000, queryFn: () => rpc<Record<string, string>>("ui_strings", { p_locale: locale }) });
  return (key: string, fallback?: string) => q.data?.[key] ?? fallback ?? key;
}
