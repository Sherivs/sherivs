/**
 * Website chrome strings in the five Sherivs languages. Block content is the school's own (Localized);
 * these are only labels the engine adds. Hausa/Yoruba/Igbo/Naija Pidgin need native-speaker review
 * before GA (tracked in docs/website-engine/SPEC.md §9).
 */
import { LOCALES, type Locale, type Localized } from "./types";

const S = {
  apply_now: {
    en: "Apply now",
    ha: "Nemi gurbin karatu",
    yo: "Forúkọsílẹ̀ báyìí",
    ig: "Tinye akwụkwọ ugbu a",
    pcm: "Apply now",
  },
  learn_more: {
    en: "Learn more",
    ha: "Ƙara karantawa",
    yo: "Kà síi",
    ig: "Mụtakwuo",
    pcm: "Learn more",
  },
  admissions: {
    en: "Admissions",
    ha: "Shiga makaranta",
    yo: "Ìgbàwọlé",
    ig: "Nnabata",
    pcm: "Admission",
  },
  requirements: {
    en: "Requirements",
    ha: "Sharuɗɗa",
    yo: "Àwọn ohun tí a nílò",
    ig: "Ihe achọrọ",
    pcm: "Wetin you need",
  },
  deadline: {
    en: "Closing date",
    ha: "Ranar rufewa",
    yo: "Ọjọ́ ìparí",
    ig: "Ụbọchị njedebe",
    pcm: "Last day",
  },
  admissions_open: {
    en: "Admissions are open",
    ha: "An buɗe shiga makaranta",
    yo: "Ìgbàwọlé ti ṣí",
    ig: "Nnabata emeghere",
    pcm: "Admission don open",
  },
  admissions_closed: {
    en: "Admissions are closed for now",
    ha: "An rufe shiga a yanzu",
    yo: "Ìgbàwọlé ti tì fún báyìí",
    ig: "Nnabata emechiela ugbu a",
    pcm: "Admission don close for now",
  },
  upcoming_events: {
    en: "Upcoming events",
    ha: "Abubuwan da ke tafe",
    yo: "Àwọn ìṣẹ̀lẹ̀ tó ń bọ̀",
    ig: "Mmemme na-abịa",
    pcm: "Events wey dey come",
  },
  latest_news: {
    en: "Latest news",
    ha: "Sabbin labarai",
    yo: "Ìròyìn tuntun",
    ig: "Akụkọ ọhụrụ",
    pcm: "Latest news",
  },
  contact_us: {
    en: "Contact us",
    ha: "Tuntuɓe mu",
    yo: "Kàn sí wa",
    ig: "Kpọtụrụ anyị",
    pcm: "Contact us",
  },
  phone: { en: "Phone", ha: "Waya", yo: "Fóònù", ig: "Ekwentị", pcm: "Phone" },
  email: { en: "Email", ha: "Imel", yo: "Ímeèlì", ig: "Email", pcm: "Email" },
  address: { en: "Address", ha: "Adireshi", yo: "Àdírẹ́sì", ig: "Adreesị", pcm: "Address" },
  office_hours: {
    en: "Office hours",
    ha: "Lokutan ofis",
    yo: "Àkókò ọ́fíìsì",
    ig: "Oge ọfịs",
    pcm: "Office time",
  },
  open_map: {
    en: "Open in maps",
    ha: "Buɗe a taswira",
    yo: "Ṣí nínú máàpù",
    ig: "Mepee na map",
    pcm: "Open for map",
  },
  check_result: {
    en: "Check a result",
    ha: "Duba sakamako",
    yo: "Wo èsì ìdánwò",
    ig: "Lelee nsonaazụ",
    pcm: "Check result",
  },
  check_result_body: {
    en: "Use the scratch-card PIN issued by the school to view a published result.",
    ha: "Yi amfani da lambar PIN da makaranta ta bayar don ganin sakamako.",
    yo: "Lo PIN tí ilé-ìwé fún ọ láti wo èsì.",
    ig: "Jiri PIN ụlọ akwụkwọ nyere lelee nsonaazụ.",
    pcm: "Use the PIN wey school give you take check result.",
  },
  donate: {
    en: "Support this campaign",
    ha: "Tallafa wa wannan",
    yo: "Ṣe àtìlẹ́yìn",
    ig: "Kwado nke a",
    pcm: "Support am",
  },
  goal: { en: "Goal", ha: "Buri", yo: "Àfojúsùn", ig: "Ebumnuche", pcm: "Target" },
  alumni_verified: {
    en: "verified alumni",
    ha: "tsofaffin ɗalibai da aka tabbatar",
    yo: "akẹ́kọ̀ọ́ àtijọ́ tí a fìdí múlẹ̀",
    ig: "ụmụ akwụkwọ mbụ akwadoro",
    pcm: "old students wey we confirm",
  },
  rooms: { en: "rooms", ha: "ɗakuna", yo: "yàrá", ig: "ime ụlọ", pcm: "rooms" },
  beds: { en: "beds", ha: "gadaje", yo: "ibùsùn", ig: "akwa", pcm: "beds" },
  boys: { en: "Boys", ha: "Maza", yo: "Ọkùnrin", ig: "Ụmụ nwoke", pcm: "Boys" },
  girls: { en: "Girls", ha: "Mata", yo: "Obìnrin", ig: "Ụmụ nwanyị", pcm: "Girls" },
  mixed: { en: "Mixed", ha: "Gauraye", yo: "Àdàpọ̀", ig: "Agwakọtara", pcm: "Mixed" },
  day: { en: "Day", ha: "Rana", yo: "Ọ̀sán", ig: "Ehihie", pcm: "Day" },
  boarding: { en: "Boarding", ha: "Kwana", yo: "Ilé-gbígbé", ig: "Ụlọ obibi", pcm: "Boarding" },
  pickup: {
    en: "Morning pick-up",
    ha: "Ɗauka da safe",
    yo: "Gbígbé láàárọ̀",
    ig: "Ịkpọrọ n'ụtụtụ",
    pcm: "Morning pick-up",
  },
  departure: {
    en: "Afternoon departure",
    ha: "Tashi da rana",
    yo: "Ìlọ ní ọ̀sán",
    ig: "Ọpụpụ n'ehihie",
    pcm: "Afternoon go-home",
  },
  coverage: {
    en: "Areas covered",
    ha: "Wuraren da ake zuwa",
    yo: "Agbègbè tí a ń lọ",
    ig: "Ebe anyị na-aga",
    pcm: "Area wey we cover",
  },
  live_tracking: {
    en: "Live bus tracking for parents",
    ha: "Bin diddigin mota kai tsaye",
    yo: "Títọpa bọ́ọ̀sì láàyè",
    ig: "Nsochi ụgbọ ala ozugbo",
    pcm: "Parents fit track bus live",
  },
  students: { en: "Students", ha: "Ɗalibai", yo: "Akẹ́kọ̀ọ́", ig: "Ụmụ akwụkwọ", pcm: "Students" },
  pupils: { en: "Pupils", ha: "Ɗalibai", yo: "Akẹ́kọ̀ọ́", ig: "Ụmụ akwụkwọ", pcm: "Pupils" },
  teachers: { en: "Teachers", ha: "Malamai", yo: "Olùkọ́", ig: "Ndị nkuzi", pcm: "Teachers" },
  programmes: {
    en: "Programmes",
    ha: "Shirye-shirye",
    yo: "Àwọn ètò",
    ig: "Mmemme",
    pcm: "Programmes",
  },
  campuses: { en: "Campuses", ha: "Harabobi", yo: "Ọgbà", ig: "Ogige", pcm: "Campus" },
  founded: { en: "Founded", ha: "An kafa", yo: "Dá sílẹ̀", ig: "Hiwere", pcm: "Start" },
  menu: { en: "Menu", ha: "Menu", yo: "Àtòjọ", ig: "Menu", pcm: "Menu" },
  language: { en: "Language", ha: "Harshe", yo: "Èdè", ig: "Asụsụ", pcm: "Language" },
  powered_by: {
    en: "Website by Sherivs",
    ha: "Shafin yanar gizo daga Sherivs",
    yo: "Ojú-òpó láti ọwọ́ Sherivs",
    ig: "Weebụsaịtị site na Sherivs",
    pcm: "Na Sherivs build dis website",
  },
  play_video: {
    en: "Play video",
    ha: "Kunna bidiyo",
    yo: "Ṣe fídíò",
    ig: "Kpọọ vidiyo",
    pcm: "Play video",
  },
  per_month: { en: "per month", ha: "a wata", yo: "lóṣù", ig: "kwa ọnwa", pcm: "every month" },
  school_bus: {
    en: "School bus",
    ha: "Motar makaranta",
    yo: "Bọ́ọ̀sì ilé-ìwé",
    ig: "Ụgbọ ala ụlọ akwụkwọ",
    pcm: "School bus",
  },
  faqs: {
    en: "Frequently asked questions",
    ha: "Tambayoyin da ake yawan yi",
    yo: "Àwọn ìbéèrè tí a sábà ń béèrè",
    ig: "Ajụjụ a na-ajụkarị",
    pcm: "Questions wey people dey ask",
  },
  not_found: {
    en: "This page is not available",
    ha: "Babu wannan shafin",
    yo: "Ojú-ìwé yìí kò sí",
    ig: "Ibe a adịghị",
    pcm: "Dis page no dey",
  },
  back_home: {
    en: "Back to the home page",
    ha: "Koma shafin farko",
    yo: "Padà sí ojú-ìwé àkọ́kọ́",
    ig: "Laghachi n'ibe mbụ",
    pcm: "Go back to home page",
  },
  mission: { en: "Our mission", ha: "Manufarmu", yo: "Iṣẹ́ wa", ig: "Ozi anyị", pcm: "Our mission" },
  vision: {
    en: "Our vision",
    ha: "Hangen nesanmu",
    yo: "Ìran wa",
    ig: "Ọhụụ anyị",
    pcm: "Our vision",
  },
  motto: { en: "Motto", ha: "Taken", yo: "Àkọlé", ig: "Ụkpụrụ", pcm: "Motto" },
} as const satisfies Record<string, Record<Locale, string>>;
export type UiKey = keyof typeof S;
export const UI_STRINGS = S;

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ha: "Hausa",
  yo: "Yorùbá",
  ig: "Igbo",
  pcm: "Naijá",
};

export function ui(key: UiKey, locale: Locale): string {
  return S[key][locale] ?? S[key].en;
}

/** Localized text with fallback: requested locale, then the site default, then English, then any. */
export function tx(v: unknown, locale: Locale, fallback: Locale = "en"): string {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object") return "";
  const o = v as Localized;
  return (o[locale] ?? o[fallback] ?? o.en ?? LOCALES.map((l) => o[l]).find(Boolean) ?? "").trim();
}
export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Default section headings per block type, used when a block has no heading of its own. */
export const BLOCK_HEADINGS: Partial<Record<string, Record<Locale, string>>> = {
  leadership: {
    en: "Our leadership",
    ha: "Shugabanninmu",
    yo: "Àwọn adarí wa",
    ig: "Ndị ndu anyị",
    pcm: "Our leaders",
  },
  sections_offered: {
    en: "What we offer",
    ha: "Abin da muke bayarwa",
    yo: "Ohun tí a ń pèsè",
    ig: "Ihe anyị na-enye",
    pcm: "Wetin we dey offer",
  },
  programmes: {
    en: "Programmes",
    ha: "Shirye-shiryen karatu",
    yo: "Àwọn ètò ẹ̀kọ́",
    ig: "Mmemme ọmụmụ",
    pcm: "Programmes",
  },
  departments: {
    en: "Faculties and departments",
    ha: "Tsangayoyi da sassa",
    yo: "Àwọn ẹ̀ka ẹ̀kọ́",
    ig: "Ngalaba na ngalaba nta",
    pcm: "Faculties and departments",
  },
  accreditation: {
    en: "Accreditation",
    ha: "Amincewa",
    yo: "Ìfọwọ́sí",
    ig: "Nnabata",
    pcm: "Accreditation",
  },
  campuses: {
    en: "Our campuses",
    ha: "Harabobinmu",
    yo: "Àwọn ọgbà wa",
    ig: "Ogige anyị",
    pcm: "Our campuses",
  },
  facilities: {
    en: "Facilities",
    ha: "Kayayyakin more rayuwa",
    yo: "Ohun èlò",
    ig: "Ngwa ọrụ",
    pcm: "Facilities",
  },
  boarding: {
    en: "Boarding",
    ha: "Makarantar kwana",
    yo: "Ilé gbígbé",
    ig: "Ụlọ obibi",
    pcm: "Boarding",
  },
  gallery: { en: "Gallery", ha: "Hotuna", yo: "Àwòrán", ig: "Foto", pcm: "Pictures" },
  testimonials: {
    en: "What families say",
    ha: "Abin da iyaye ke cewa",
    yo: "Ohun tí àwọn òbí ń sọ",
    ig: "Ihe ezinụlọ na-ekwu",
    pcm: "Wetin families talk",
  },
  alumni: {
    en: "Alumni",
    ha: "Tsofaffin dalibai",
    yo: "Àwọn akẹ́kọ̀ọ́ àtijọ́",
    ig: "Ụmụ akwụkwọ mbụ",
    pcm: "Old students",
  },
  donations: {
    en: "Support us",
    ha: "Tallafa mana",
    yo: "Ṣe àtìlẹ́yìn fún wa",
    ig: "Kwado anyị",
    pcm: "Support us",
  },
  map: {
    en: "Find us",
    ha: "Inda muke",
    yo: "Ibi tí a wà",
    ig: "Ebe anyị nọ",
    pcm: "Where we dey",
  },
  agencies: { en: "Services", ha: "Ayyuka", yo: "Iṣẹ́", ig: "Ọrụ", pcm: "Services" },
  staff_directory: {
    en: "Our staff",
    ha: "Ma'aikatanmu",
    yo: "Òṣìṣẹ́ wa",
    ig: "Ndị ọrụ anyị",
    pcm: "Our staff",
  },
  fees: {
    en: "Fees",
    ha: "Kudin makaranta",
    yo: "Owó ilé-ìwé",
    ig: "Ụgwọ akwụkwọ",
    pcm: "School fees",
  },
};
