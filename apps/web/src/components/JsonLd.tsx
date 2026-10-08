// A backslash followed by "u003c": the JSON escape for "<".
const ESCAPED_LESS_THAN = `${String.fromCharCode(92)}u003c`;

/** Structured data for search engines, embedded in the page. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // "<" is escaped so the data can never end the script element early.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, ESCAPED_LESS_THAN) }}
    />
  );
}
