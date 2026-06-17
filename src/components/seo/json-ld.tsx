import type { JsonLdNode } from "@/lib/seo/json-ld";

/**
 * Renders one or more schema.org JSON-LD documents in a <script> tag.
 *
 * The `<` escaping prevents a `</script>` sequence inside any string value from
 * breaking out of the script element (the XSS hole the legacy /why-xpert inline
 * JSON-LD has). Server component — safe to drop into any RSC page.
 */
export function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
