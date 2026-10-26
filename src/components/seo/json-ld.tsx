import { serializeJsonLd } from "@/lib/seo";

// One <script type="application/ld+json"> per block; the data comes from the
// builders in lib/seo.ts.
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
