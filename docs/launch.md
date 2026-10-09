# Launch checklist and draft text (Phase 8.4 to 8.6)

**Nothing here has happened.** The checklist is for the owner to work through; the text
is a first draft to rewrite in their own voice. No video or screenshots have been made:
they should show real handwriting, and none exists yet.

## Rules for everything public

- Never say or imply the output cannot be told apart from real handwriting. It can.
- No invented numbers, reviews or user quotes. Use real ones or none.
- Say what it is for: a handwritten version of your own text, in your own handwriting.
  Say what it is not for: imitating someone else, or work that must be written by hand.
- Follow each community's rules on self-promotion. If they say no, do not post.

## Before launch day

- [ ] The beta gate passed and the top five problems are fixed (`docs/beta-plan.md`).
- [ ] The product has its real name, domain and support address everywhere.
- [ ] Legal pages reviewed; the "draft" notice removed only then.
- [ ] Prices final in `plans.ts` and in Paddle, live keys in production.
- [ ] A purchase and a refund both tested on production with a real card.
- [ ] Search Console connected, sitemap submitted; Rich Results Test run on the home,
      pricing and FAQ pages.
- [ ] PageSpeed Insights run on the deployed site (target: mobile 90 or more).
- [ ] The load test repeated against the deployed worker; alerts arrive in the channel.
- [ ] Backups on, and one restore tried.
- [ ] A person is named to answer support email for the first 48 hours.

## Assets to make

- [ ] **Demo video, 30 to 60 seconds:** write the sample, photograph it, upload a
      document, show the page. Real handwriting, real phone, no speed-up tricks that hide
      the waiting.
- [ ] **Screenshots:** the sample step, the editor with preview, a finished page next to
      the same person's real writing.
- [ ] **A side-by-side picture** of typed text, a handwriting font, and this, for the
      same sentence (`pnpm benchmark` makes one from the test letters).

## Draft text

### One sentence

> Turn a typed document into a page in your own handwriting: write one sample page,
> photograph it, and every document after that is written with your letters.

### Product Hunt (draft)

**Tagline:** Your documents, in your own handwriting.

**Description:** Handwriting fonts give every "a" the same shape on a perfectly straight
line, which is why they look printed. This starts from your own writing instead: you copy
a short text by hand, take a photo, and your letters are cut out in your browser. Any Word
or PDF file is then written with them, with the small differences real writing has: letters
vary, lines drift, the pen changes.

It will not fool someone who knows your handwriting well, and it is not meant to. It works
best with letters written separately; joined-up writing is not well supported yet. Your
sample photo never leaves your device. There is a free plan with a few watermarked pages
a month.

**First comment (maker):** what it does badly today, plainly: joined writing, scanned
PDFs, anything beyond Latin letters. And what you would like testers to try.

### Community post (draft, for places that allow it)

> I built a tool that writes typed documents in your own handwriting. You write one sample
> page, it cuts out your letters, and uses them. I am a student/developer and made it
> because [the real reason].
>
> Honest limits: it works with print-style writing, not joined-up; a careful reader can
> tell; please do not use it where the work has to be handwritten by you.
>
> It is free to try. I would like to know where it gets your handwriting wrong.

Fill in the real reason or do not post. Check the rules of each community first; many
ban this kind of post, and several student communities ban tools that could be used to
get around handwritten-work rules.

### Referral push

Every account has an invite code on its account page; both people get 20 pages. That is
built. A student-ambassador programme is not: it needs people.

## Launch day and the two days after (8.5)

- Every hour: the alert channel, `/admin/costs` (is a page costing more than $0.01?),
  `/admin/feedback`, the support inbox.
- If exports queue badly (many "busy" answers), give the worker more CPU. Do not add a
  second machine (`docs/runbook.md`).
- Answer every message. The gate is the first 10 paying users.

## Reviews at week 2 and week 4 (8.6)

| Question                               | Where the answer is                                  |
| -------------------------------------- | ---------------------------------------------------- |
| Signed up, then exported at least once | accounts against first completed export              |
| Free to paid                           | accounts by plan                                     |
| Cancelled                              | accounts with `cancel_at_period_end` or back on free |
| Cost per page, margin per plan         | `/admin/costs`                                       |
| What people complain about             | `/admin/feedback`, support inbox                     |

Decide what to build next from those, and write the decision down.
