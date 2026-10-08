import { Faq } from '../../components/Faq';
import { pageMetadata } from '../../lib/site';

export const metadata = {
  ...pageMetadata({
    title: 'Design system',
    description: 'The colours, type and components this site is built from.',
    path: '/style',
  }),
  // An internal reference page: no reason for it to appear in search results.
  robots: { index: false, follow: false },
};

const COLOURS = [
  ['--accent', 'Accent'],
  ['--text', 'Text'],
  ['--muted', 'Muted text'],
  ['--surface', 'Surface'],
  ['--page', 'Page'],
  ['--line', 'Line'],
  ['--warn-bg', 'Notice'],
  ['--danger', 'Error'],
] as const;

export default function StylePage() {
  return (
    <div className="section">
      <h1>Design system</h1>
      <p className="lead">
        One accent colour, system fonts for text, and a handwriting-style face for display headings
        only. Light and dark follow the device setting. Everything is in <code>globals.css</code>.
      </p>

      <h2>Colour</h2>
      <div className="swatches">
        {COLOURS.map(([variable, label]) => (
          <div className="swatch" key={variable}>
            <span style={{ background: `var(${variable})` }} />
            <code>{label}</code>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: '1.5rem' }}>Type</h2>
      <p className="display" style={{ fontSize: '2.4rem', margin: 0 }}>
        Display heading, <em>with emphasis</em>
      </p>
      <h1>Heading 1</h1>
      <h2>Heading 2</h2>
      <h3>Heading 3</h3>
      <p>
        Body text. <a href="/style">A link.</a> <span className="muted">Muted text.</span>
      </p>
      <p className="lead">Lead paragraph, for the line under a page heading.</p>

      <h2 style={{ marginTop: '1.5rem' }}>Buttons and fields</h2>
      <div className="row">
        <button type="button" className="primary">
          Primary
        </button>
        <button type="button">Default</button>
        <button type="button" className="small">
          Small
        </button>
        <button type="button" disabled>
          Disabled
        </button>
        <a className="button" href="/style">
          Link button
        </a>
        <span className="badge">Badge</span>
      </div>
      <div className="grid" style={{ marginTop: '0.75rem' }}>
        <div className="field">
          <label>
            Text field
            <input type="text" defaultValue="Value" />
          </label>
        </div>
        <div className="field">
          <label>
            Select
            <select defaultValue="b">
              <option value="a">First</option>
              <option value="b">Second</option>
            </select>
          </label>
        </div>
        <div className="field">
          <label>
            Slider
            <input type="range" defaultValue={40} />
          </label>
        </div>
      </div>

      <h2 style={{ marginTop: '1.5rem' }}>Messages</h2>
      <p className="notice">A notice: something to check before going on.</p>
      <p className="error">An error: something went wrong.</p>

      <h2 style={{ marginTop: '1.5rem' }}>Cards</h2>
      <div className="grid">
        <div className="card">
          <h3>Card</h3>
          <p className="muted">A surface for one idea.</p>
        </div>
        <div className="card featured">
          <h3>Featured card</h3>
          <p className="price">
            $4<small> / month</small>
          </p>
          <ul className="checks">
            <li>Check list item</li>
            <li>Another item</li>
          </ul>
        </div>
        <div className="panel">
          <h3>Panel</h3>
          <p className="muted">The flat container used inside the app.</p>
        </div>
      </div>

      <h2 style={{ marginTop: '1.5rem' }}>Questions</h2>
      <div className="narrow" style={{ margin: 0 }}>
        <Faq items={[{ question: 'A question that opens on tap', answer: 'And its answer.' }]} />
      </div>

      <h2 style={{ marginTop: '1.5rem' }}>Table</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>Pages</th>
              <th>Per page</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Student</td>
              <td>150</td>
              <td>$0.0010</td>
            </tr>
            <tr className="over-limit">
              <td>Over the limit</td>
              <td>900</td>
              <td>$0.0142</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
