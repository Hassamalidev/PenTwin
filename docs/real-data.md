# Real handwriting data

Real pages are used to measure how handwriting behaves. **No real handwriting image is ever
stored in this repository, shipped, or used as letter shapes in the product.** Only summary
numbers are kept (`packages/engine/src/real-ranges.json`).

## Used for the numbers

CSAFE Handwriting Database v2. Crawford, Ray, Carriquiry, Kruse, Peterson, Center for
Statistics and Applications in Forensic Evidence, Iowa State University. Licensed CC BY 4.0.
doi:10.25380/iastate.10062203. 51 pages from 26 writers: blue ballpoint, plain paper, 300
dpi, each writer copying a passage from The Wizard of Oz and the London Letter. The writers copied set texts, so this is not spontaneous writing, and the
writers are not students writing assignments.

## Collected, not used for the numbers

Public-domain pages (US government, mostly 1940s to 1970s) and CC BY field notebooks are kept
outside the repository as reference for how real pages look. Older writing differs from
modern writing, so they do not set any target.

## Used to test the extractor

`pnpm real:render <folder>` cuts a real writer's letters from those pages and writes new text
with them, into the ignored `test-results/real-hand` folder. Pictures made this way are for
checking only and are never committed.

## Refused

IAM, CVL, RIMES and IMGUR5K are non-commercial. Washington needs registration. GNHK, NIST
SD19 and a few archive items need a licence decision by the owner and were not downloaded.

## Reproducing

    python -I scripts/to-pgm.py <folder of images> <folder for .pgm files> w
    pnpm real:measure <folder of .pgm files> --write
