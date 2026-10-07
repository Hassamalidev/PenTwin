# Name & domain check (Task 0.7)

Checked 2026-10-07. **Decision (owner, 2026-10-07): "PenTwin" is a placeholder, not the final name.** Two things stand in its way: the similar existing product InkTwin, and pentwin.com being registered by someone else.

Because the name may change, it is defined once in `packages/shared/src/brand.ts`. Code and UI must read it from there and never hard-code it.

## Domains

Checked by RDAP lookup. "No record" means no registration was found; confirm at a registrar before relying on it.

| Domain      | Result                                                          |
| ----------- | --------------------------------------------------------------- |
| pentwin.com | **Registered** 2026-02-16 (registrar: Sav.com), near-empty page |
| pentwin.app | No record                                                       |
| pentwin.io  | No record                                                       |
| pentwin.co  | No record                                                       |
| ownhand.com | **Registered** since 2014                                       |
| ownhand.app | **Registered**                                                  |
| ownhand.io  | No record                                                       |

## Social handles

- GitHub `pentwin`: available (profile URL returns 404).
- X and Instagram `pentwin`: could not be determined automatically (both sites return the same response for taken and free handles). Check by hand.

## Trademark and similar names

- A web search found no existing product or company called "PenTwin".
- **InkTwin** ("Your handwriting, digitally yours") is an existing handwriting product listed on Product Hunt. Same category and a very similar name, so there is some risk of confusion.
- No trademark registry was searched. This is not a clearance.

## Before the name is final

Settle this before Phase 6 (landing page, SEO), where the name gets baked into public pages and search listings.

1. Pick the final name. If it stays PenTwin, choose between `pentwin.app` and trying to buy the .com.
2. Check the X and Instagram handles for the chosen name and register them.
3. Search USPTO, WIPO Global Brand Database and IPO Pakistan for the chosen name in software classes (9 and 42).

## Fallback

OwnHand is weaker on domains: the .com and .app are both taken, only .io showed no record. If PenTwin has to be dropped, pick a new fallback rather than assuming OwnHand works.
