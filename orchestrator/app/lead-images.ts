// Screenshots in the composer to a lead (2026-11-17, the owner: "in the projects tab the chat with lead input needs to be
// able to take in images i can copy-paste from screenshots and the same thing applies to the scoping input"). The
// rules the composer keeps before anything is sent, without JSX so node --test checks them; the server checks again
// (core/direct-images.ts). A refusal says why in a line under the field; nothing here reads or logs an image's bytes.
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "../contract.ts";

/** What the composer knows of a file before it reads it. */
export type Picked = { name: string; type: string; size: number };

const MB = MAX_IMAGE_BYTES / 1024 / 1024;
const accepted = (type: string) => (IMAGE_TYPES as readonly string[]).includes(type);
/** The file picker's filter: the four types a lead's file reader opens as images. */
export const ACCEPT = IMAGE_TYPES.join(",");

/**
 * Which of the files offered (a paste, a drop, the picker) join the `have` already attached: each of an accepted type,
 * at most MAX_IMAGE_BYTES, and no more than MAX_IMAGES in all, in the order offered. `refused` says why the rest stay
 * out, or is null when all were taken.
 */
export function admit(have: number, files: readonly Picked[]): { take: number[]; refused: string | null } {
  const take: number[] = [];
  const why: string[] = [];
  files.forEach((f, i) => {
    const name = f.name || "The image";
    if (!accepted(f.type)) why.push(`${name} isn't a png, jpeg, gif or webp image`);
    else if (f.size > MAX_IMAGE_BYTES) why.push(`${name} is over ${MB} MB`);
    else if (have + take.length >= MAX_IMAGES) why.push(`${name} is past the ${MAX_IMAGES} images a message takes`);
    else take.push(i);
  });
  if (!why.length) return { take, refused: null };
  return { take, refused: why.length === 1 ? `${why[0]}.` : `${why[0]}, and ${why.length - 1} more not added.` };
}

/** Only image files from a paste or a drop: text pasted with no image in it stays the text box's own. */
export function imageFiles<F extends Picked>(files: ArrayLike<F>): F[] {
  return Array.from(files).filter((f) => f.type.startsWith("image/"));
}

/** A message goes with words, with images, or with both. */
export function canSend(text: string, images: number): boolean {
  return text.trim().length > 0 || images > 0;
}

/** What the composer's quiet line says while images are attached. */
export function imagesLabel(n: number): string {
  return n === 1 ? "1 image attached" : `${n} images attached`;
}
