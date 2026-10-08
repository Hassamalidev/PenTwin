import { BRAND } from '@pentwin/shared';

export default function Home() {
  return (
    <section className="panel narrow">
      <h1>Turn any document into your own handwriting</h1>
      <p>
        {BRAND.name} learns your handwriting from one page you write and photograph, then writes
        your documents in it.
      </p>
      <ol className="steps">
        <li>
          <a href="/sample">Add your handwriting</a>: copy a short text by hand and take a photo.
        </li>
        <li>
          <a href="/editor">Open the editor</a>: upload a Word or PDF file, or paste your text.
        </li>
        <li>Check the preview, then export a PDF.</li>
      </ol>
      <p className="muted">
        No sample yet? The editor works straight away with a demo handwriting, so you can see how it
        behaves first.
      </p>
    </section>
  );
}
