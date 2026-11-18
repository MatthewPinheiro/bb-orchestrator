// Screenshots in the owner's direct messages (2026-11-17, the owner: "images or screenshots ... copy-paste from
// screenshots"). The page sends each image on its own write; the server checks it here (its bytes, not the type the
// page claims), keeps it as a file, and the message carries its id. The lead gets the files' absolute paths in the
// message text (what orch_inbox shows, the CoS copy too), and, delivered one by one, as bb's own image inputs.
// Nothing here logs or returns an image's bytes.

/** The types a lead's file reader opens as images, and the caps: checked on the page before upload, and again here. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 6;

export type ImageType = (typeof IMAGE_TYPES)[number];
/** One image a direct message carries, as the server keeps it. */
export interface DirectImage {
  id: string;
  name: string;
  mime: ImageType;
  size: number;
  path: string; // absolute, on this machine
  sourceProject: string | null; // the bb project its upload went to, when bb's attachments took it
}

const EXT: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** What the bytes are, by their signature, or null for anything but the four accepted types. */
export function sniff(b: Uint8Array): ImageType | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** A file name safe on disk and in a message: letters, digits, dot, dash and underscore, ending in the type's extension. */
export function safeName(name: string, mime: ImageType): string {
  const stem = (name.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "image";
  return `${stem}.${EXT[mime]}`;
}

/** The line a message with images ends with: how many, and where each is, so a lead that reads text can open them. */
export function imagesNote(images: Pick<DirectImage, "path">[]): string {
  if (!images.length) return "";
  const n = images.length;
  return `(${n} image${n === 1 ? "" : "s"} attached; open each with your file reader: ${images.map((i) => i.path).join(", ")})`;
}

/** One image as bb's own thread input: the lead (or the CoS) sees it as an image, not a path. */
export function imageInput(i: Pick<DirectImage, "path" | "sourceProject">): { type: "localImage"; path: string; sourceProjectId?: string } {
  return { type: "localImage", path: i.path, ...(i.sourceProject ? { sourceProjectId: i.sourceProject } : {}) };
}

/** The message body: the owner's words, then the images' line. */
export function withImages(text: string, images: Pick<DirectImage, "path">[]): string {
  const note = imagesNote(images);
  return [text, note].filter(Boolean).join("\n\n");
}

/** The owner's words of a body withImages made (the page shows the images apart). */
export function wordsOf(body: string, images: Pick<DirectImage, "path">[]): string {
  const note = imagesNote(images);
  if (!note || !body.endsWith(note)) return body;
  return body.slice(0, body.length - note.length).replace(/\s+$/, "");
}
