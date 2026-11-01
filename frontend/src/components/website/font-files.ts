/** Self-hosted variable font files (fontsource, SIL OFL 1.1). Bundled by Vite with hashed URLs; no third-party font requests.
 * Subsets: latin, latin-ext (Hausa ɓ ɗ ƙ, Igbo ị ọ ụ ṅ) and vietnamese (Yorùbá ẹ ọ with tone marks). */
import inter_latin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import inter_latin_ext from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url";
import inter_vietnamese from "@fontsource-variable/inter/files/inter-vietnamese-wght-normal.woff2?url";
import montserrat_latin from "@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2?url";
import montserrat_latin_ext from "@fontsource-variable/montserrat/files/montserrat-latin-ext-wght-normal.woff2?url";
import montserrat_vietnamese from "@fontsource-variable/montserrat/files/montserrat-vietnamese-wght-normal.woff2?url";
import nunito_latin from "@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url";
import nunito_latin_ext from "@fontsource-variable/nunito/files/nunito-latin-ext-wght-normal.woff2?url";
import nunito_vietnamese from "@fontsource-variable/nunito/files/nunito-vietnamese-wght-normal.woff2?url";
import playfair_display_latin from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url";
import playfair_display_latin_ext from "@fontsource-variable/playfair-display/files/playfair-display-latin-ext-wght-normal.woff2?url";
import playfair_display_vietnamese from "@fontsource-variable/playfair-display/files/playfair-display-vietnamese-wght-normal.woff2?url";
import source_serif_4_latin from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url";
import source_serif_4_latin_ext from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-wght-normal.woff2?url";
import source_serif_4_vietnamese from "@fontsource-variable/source-serif-4/files/source-serif-4-vietnamese-wght-normal.woff2?url";
import source_sans_3_latin from "@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url";
import source_sans_3_latin_ext from "@fontsource-variable/source-sans-3/files/source-sans-3-latin-ext-wght-normal.woff2?url";
import source_sans_3_vietnamese from "@fontsource-variable/source-sans-3/files/source-sans-3-vietnamese-wght-normal.woff2?url";
import merriweather_latin from "@fontsource-variable/merriweather/files/merriweather-latin-wght-normal.woff2?url";
import merriweather_latin_ext from "@fontsource-variable/merriweather/files/merriweather-latin-ext-wght-normal.woff2?url";
import merriweather_vietnamese from "@fontsource-variable/merriweather/files/merriweather-vietnamese-wght-normal.woff2?url";
import roboto_slab_latin from "@fontsource-variable/roboto-slab/files/roboto-slab-latin-wght-normal.woff2?url";
import roboto_slab_latin_ext from "@fontsource-variable/roboto-slab/files/roboto-slab-latin-ext-wght-normal.woff2?url";
import roboto_slab_vietnamese from "@fontsource-variable/roboto-slab/files/roboto-slab-vietnamese-wght-normal.woff2?url";
import lora_latin from "@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url";
import lora_latin_ext from "@fontsource-variable/lora/files/lora-latin-ext-wght-normal.woff2?url";
import lora_vietnamese from "@fontsource-variable/lora/files/lora-vietnamese-wght-normal.woff2?url";

export const FONT_FILES: Record<string, { family: string; files: [string, string, string] }> = {
  inter: { family: "Inter", files: [inter_latin, inter_latin_ext, inter_vietnamese] },
  montserrat: {
    family: "Montserrat",
    files: [montserrat_latin, montserrat_latin_ext, montserrat_vietnamese],
  },
  nunito: { family: "Nunito", files: [nunito_latin, nunito_latin_ext, nunito_vietnamese] },
  "playfair-display": {
    family: "Playfair Display",
    files: [playfair_display_latin, playfair_display_latin_ext, playfair_display_vietnamese],
  },
  "source-serif-4": {
    family: "Source Serif 4",
    files: [source_serif_4_latin, source_serif_4_latin_ext, source_serif_4_vietnamese],
  },
  "source-sans-3": {
    family: "Source Sans 3",
    files: [source_sans_3_latin, source_sans_3_latin_ext, source_sans_3_vietnamese],
  },
  merriweather: {
    family: "Merriweather",
    files: [merriweather_latin, merriweather_latin_ext, merriweather_vietnamese],
  },
  "roboto-slab": {
    family: "Roboto Slab",
    files: [roboto_slab_latin, roboto_slab_latin_ext, roboto_slab_vietnamese],
  },
  lora: { family: "Lora", files: [lora_latin, lora_latin_ext, lora_vietnamese] },
};
