import { expect, test } from '@playwright/test';
import { PLANS } from '../packages/shared/src/plans';
import { PUBLIC_PATHS } from '../apps/web/src/lib/paths';
import { DESCRIPTION_LIMIT, TITLE_LIMIT } from '../apps/web/src/lib/site';

/** The public site: what a visitor and a search engine get. */

// Structured data is free-form JSON; the tests pick out the few fields they check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Structured = Record<string, any>;
const SITE = 'https://example.test';

test('every public page has one H1, a unique title and description, and a canonical address', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'page metadata is the same at every width');
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();

  for (const path of PUBLIC_PATHS) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('h1'), `one H1 on ${path}`).toHaveCount(1);

    const title = await page.title();
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(title.length, `title of ${path}: "${title}"`).toBeLessThanOrEqual(TITLE_LIMIT);
    expect(title.length, path).toBeGreaterThan(10);
    expect(description!.length, `description of ${path}`).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(description!.length, path).toBeGreaterThan(50);
    expect(titles.has(title), `"${title}" is used by ${titles.get(title)} and ${path}`).toBe(false);
    expect(descriptions.has(description!), `description of ${path} repeats`).toBe(false);
    titles.set(title, path);
    descriptions.set(description!, path);

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE}${path === '/' ? '' : path}`,
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      `${SITE}/og.png`,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );

    // All structured data on the page is valid JSON with a type.
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length, path).toBeGreaterThan(0);
    for (const block of blocks) expect(JSON.parse(block)['@type'], path).toBeTruthy();

    // Honest wording everywhere: the product never claims to be undetectable.
    const text = (await page.locator('body').innerText()).toLowerCase();
    expect(text, path).not.toContain('undetectable');
    expect(text, path).not.toMatch(/testimonial|trusted by \d|rated \d/);
  }
  expect(titles.size).toBe(PUBLIC_PATHS.length);
});

test('the structured data covers the application, offers, questions, organisation and breadcrumbs', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'structured data is the same at every width');
  const typesOn = async (path: string): Promise<Structured[]> => {
    await page.goto(path);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    return blocks.map((block) => JSON.parse(block) as Structured);
  };
  const byType = (data: Structured[], type: string): Structured[] =>
    data.filter((d) => d['@type'] === type);

  const home = await typesOn('/');
  expect(byType(home, 'Organization')).toHaveLength(1);
  const [app] = byType(home, 'SoftwareApplication');
  expect(app!.offers.map((offer: { price: string }) => offer.price)).toEqual([
    PLANS.free.price.month.toFixed(2),
    PLANS.student.price.month.toFixed(2),
    PLANS.pro.price.month.toFixed(2),
  ]);

  const pricing = await typesOn('/pricing');
  expect(byType(pricing, 'Product')[0]!.offers).toHaveLength(3);
  expect(byType(pricing, 'FAQPage')).toHaveLength(1);
  expect(byType(pricing, 'BreadcrumbList')[0]!.itemListElement).toHaveLength(2);

  const faq = await typesOn('/faq');
  const [questions] = byType(faq, 'FAQPage');
  expect(byType(faq, 'FAQPage')).toHaveLength(1);
  expect(questions!.mainEntity.length).toBeGreaterThan(10);
  // What search engines are told is exactly what the page says.
  const first = questions!.mainEntity[0];
  await expect(page.getByText(first.name, { exact: true })).toBeVisible();

  const post = await typesOn('/blog/handwriting-generator-vs-fonts');
  expect(byType(post, 'Article')[0]!.headline).toBe('Handwriting generator vs handwriting fonts');
  expect(byType(post, 'BreadcrumbList')[0]!.itemListElement).toHaveLength(3);
});

test('sitemap and robots list the public pages and keep the app out', async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of PUBLIC_PATHS) {
    expect(sitemap).toContain(`<loc>${SITE}${path === '/' ? '' : path}</loc>`);
  }
  expect(sitemap).not.toContain('/editor');
  expect(sitemap).not.toContain('/admin');

  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  for (const path of ['/editor', '/sample', '/admin'])
    expect(robots).toContain(`Disallow: ${path}`);
  expect((await request.get('/og.png')).headers()['content-type']).toBe('image/png');
});

test('the landing page: headline, live demo without signing in, comparison, gallery', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Turn any document into your own handwriting.');

  // The demo needs no account and reacts to typing.
  const demo = page.getByTestId('live-demo');
  await demo.scrollIntoViewIfNeeded();
  const image = demo.getByTestId('demo-image');
  await expect(image).toBeVisible();
  const before = await image.getAttribute('src');
  await demo.getByTestId('demo-text').fill('Dear Sara, thank you for the notes.');
  await expect.poll(() => image.getAttribute('src')).not.toBe(before);
  const typed = await image.getAttribute('src');
  await demo.getByTestId('demo-style').selectOption('rushed');
  await expect.poll(() => image.getAttribute('src')).not.toBe(typed);

  // The typed-versus-handwritten slider moves.
  const written = page.locator('.compare .written');
  const slider = page.getByRole('slider', { name: /typed text and the handwritten/ });
  await slider.fill('20');
  const narrow = (await written.boundingBox())!.width;
  await slider.fill('90');
  expect((await written.boundingBox())!.width).toBeGreaterThan(narrow * 3);

  // At least six real outputs, each described for people who cannot see them.
  const pictures = page.getByTestId('gallery').locator('img');
  expect(await pictures.count()).toBeGreaterThanOrEqual(6);
  for (const alt of await pictures.evaluateAll((list) =>
    list.map((img) => img.getAttribute('alt')),
  )) {
    expect(alt!.length).toBeGreaterThan(40);
  }

  // Legal pages are linked from every page's footer.
  for (const name of ['Terms', 'Privacy', 'Refunds', 'Acceptable use']) {
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name, exact: true }),
    ).toBeVisible();
  }
  // Nothing sticks out sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
});

test('pricing shows the prices from the plan config and switches to yearly', async ({
  page,
}, testInfo) => {
  await page.goto('/pricing');
  await expect(page.getByTestId('price-free')).toHaveText('Free');
  await expect(page.getByTestId('price-student')).toHaveText(
    `$${PLANS.student.price.month} / month`,
  );
  await expect(page.getByTestId('price-pro')).toHaveText(`$${PLANS.pro.price.month} / month`);
  await expect(page.getByTestId('plan-student')).toContainText(
    `${PLANS.student.monthlyPages} pages every month`,
  );
  await expect(page.getByTestId('plan-student')).toContainText('For students');
  await expect(page.getByTestId('plan-free')).toContainText('Watermark');

  await page.getByTestId('yearly').click();
  await expect(page.getByTestId('price-student')).toHaveText(`$${PLANS.student.price.year} / year`);
  await expect(page.getByTestId('price-pro')).toHaveText(`$${PLANS.pro.price.year} / year`);
  await expect(page.getByTestId('price-free')).toHaveText('Free');

  await expect(page.getByText('What is a credit?')).toBeVisible();
  await page.getByText('What is a credit?').click();
  await expect(page.locator('.faq').getByText('One credit is one exported page.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pricing.png'), fullPage: true });
});

test('the legal pages are marked as drafts until reviewed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  for (const slug of ['terms', 'privacy', 'refunds', 'acceptable-use']) {
    await page.goto(`/legal/${slug}`);
    await expect(page.getByTestId('legal-draft')).toBeVisible();
  }
  await expect(page.getByText('Forging signatures')).toBeVisible();
});
