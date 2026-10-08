import Image from 'next/image';
import { GALLERY } from '../lib/gallery';

/** Real output of the engine in several styles. Pictures load as they scroll into view. */
export function Gallery({ only }: { only?: readonly (typeof GALLERY)[number]['id'][] }) {
  const items = only ? GALLERY.filter((item) => only.includes(item.id)) : GALLERY;
  return (
    <div className="gallery" data-testid="gallery">
      {items.map((item) => (
        <figure key={item.id}>
          <Image
            src={`/gallery/${item.id}.png`}
            alt={item.alt}
            width={699}
            height={992}
            sizes="(min-width: 900px) 260px, (min-width: 520px) 45vw, 92vw"
          />
          <figcaption>
            <strong>{item.title}.</strong> {item.caption}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
