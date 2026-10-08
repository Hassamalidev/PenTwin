'use client';

import Image from 'next/image';
import { useState } from 'react';
import { HERO_TEXT } from '../lib/gallery';

/**
 * The same sentence typed and handwritten, with a slider to wipe between the two.
 * The typed side is real text; the handwritten side is a picture made by the engine.
 */
export function CompareSlider() {
  const [share, setShare] = useState(55);
  return (
    <div>
      <div className="compare" data-testid="compare">
        <p className="typed">{HERO_TEXT}</p>
        <div className="written" style={{ width: `${share}%` }}>
          <Image
            src="/gallery/hero-handwritten.png"
            alt={`Handwritten: ${HERO_TEXT}`}
            width={1100}
            height={383}
            priority
            sizes="(min-width: 900px) 520px, 92vw"
          />
        </div>
      </div>
      <input
        className="compare-control"
        type="range"
        min={0}
        max={100}
        value={share}
        aria-label="Slide between the typed text and the handwritten version"
        onChange={(event) => setShare(Number(event.target.value))}
      />
    </div>
  );
}
