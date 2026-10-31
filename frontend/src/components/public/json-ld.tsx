import { jsonLdJson } from "@/lib/security/json-ld";

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdJson(data) }} />
  );
}
