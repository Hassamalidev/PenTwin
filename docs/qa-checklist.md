# Cross-browser and device checklist (Phase 7.9)

Last run 2026-10-08, commit `776be06`, in CI on Linux (job `browsers`) and on the
development laptop. **Every result below comes from an automated test in a browser engine
on a computer. No real phone, tablet or Mac has been used.** An emulated phone has a
phone's screen size, touch and browser name, but not its camera, memory, speed or
file picker.

## What the tests do

The same flows run in each browser against the built site and a running worker:

| Flow                                                                                     | Test file               |
| ---------------------------------------------------------------------------------------- | ----------------------- |
| Sample photo, glyph bank, Word upload, preview, export, download the PDF                 | `e2e/full-flow.spec.ts` |
| An unusable photo is turned away with advice                                             | `e2e/full-flow.spec.ts` |
| A PDF uploads into editable paragraphs; a wrong file type is refused                     | `e2e/full-flow.spec.ts` |
| The editor opens with a live preview                                                     | `e2e/editor.spec.ts`    |
| Landing page: live demo reacts to typing, comparison slider, gallery, no sideways scroll | `e2e/site.spec.ts`      |
| Pricing: prices from the plan config, yearly toggle, credits FAQ                         | `e2e/site.spec.ts`      |
| Cost dashboard                                                                           | `e2e/costs.spec.ts`     |

In the "photo" flows the test hands the page an image file. That exercises everything
after the file picker, and nothing about a real camera.

## Results

| Browser                           | How it was run                          | Result     |
| --------------------------------- | --------------------------------------- | ---------- |
| Chrome (Chromium), desktop        | CI and laptop, every push               | Pass       |
| Chrome, 380px wide with touch     | CI and laptop, every push               | Pass       |
| Firefox, desktop                  | CI on Linux                             | Pass       |
| WebKit (Safari's engine), desktop | CI on Linux                             | Pass       |
| iPhone 13, **emulated** (WebKit)  | CI on Linux                             | Pass       |
| Pixel 7, **emulated** (Chromium)  | CI on Linux and laptop                  | Pass       |
| Edge, desktop                     | **Not run.** It shares Chrome's engine. | Not tested |
| Safari on a real Mac              | **Not run.**                            | Not tested |
| Safari on a real iPhone           | **Not run.**                            | Not tested |
| Chrome on a real Android phone    | **Not run.**                            | Not tested |

Firefox and WebKit could not be started on the development laptop (Windows reports a
missing system library for both), so their results come from CI only.

## Still to check by hand, on real devices

These cannot be automated here and matter most, because most users are on phones.

- [ ] **iPhone, Safari:** take the sample photo with the camera from the "take a photo"
      button. Does the camera open? Does a portrait photo arrive upright? Are HEIC photos
      (the iPhone default) accepted, or does the user get the "use a JPEG or PNG" message?
- [ ] **Android, Chrome:** the same, with the camera and with a photo from the gallery.
- [ ] How long a full-resolution phone photo takes to process on a mid-range phone (the
      1.6 s figure in the tracker is from a desktop).
- [ ] The exported PDF opens from the download on both phones, and in the Files app.
- [ ] The editor is usable with the on-screen keyboard open at 380px.
- [ ] Safari on a Mac and Edge on Windows: one pass through the whole flow.
- [ ] A slow connection (3G throttling on a real phone): the demo and the editor still load.

**Known risk to look at first:** HEIC. The app accepts JPEG, PNG and WebP by their first
bytes. An iPhone normally converts to JPEG when a web page asks for a photo, but if it
hands over a HEIC file the user is refused with the "not a picture we can read" message.

## How to repeat

```bash
pnpm e2e            # Chrome, desktop and 380px
pnpm e2e:browsers   # Firefox, WebKit, emulated iPhone and Pixel (set ALL_BROWSERS=1)
```

`pnpm e2e:browsers` needs `pnpm exec playwright install firefox webkit` once. In CI both
run on every push.
