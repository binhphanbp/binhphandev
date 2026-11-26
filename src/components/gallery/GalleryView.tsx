"use client";

import { Media, MasonryGrid } from "@once-ui-system/core";
import { gallery } from "@/resources";

export default function GalleryView() {
  return (
    <MasonryGrid columns={2} s={{ columns: 1 }}>
      {gallery.images.map((image, index) => (
        <div
          key={index}
          data-swarm-target="gallery-photo"
          data-swarm-group="gallery-photos"
          data-swarm-inspect="true"
          data-swarm-label={`Gallery · Photo ${String(index + 1).padStart(2, "0")}`}
          style={{ width: "100%" }}
        >
          <Media
            enlarge
            priority={index < 10}
            sizes="(max-width: 560px) 100vw, 50vw"
            radius="m"
            aspectRatio={image.orientation === "horizontal" ? "16 / 9" : "3 / 4"}
            src={image.src}
            alt={image.alt}
          />
        </div>
      ))}
    </MasonryGrid>
  );
}
