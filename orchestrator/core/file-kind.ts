// Which of a deliverable's three folders a file goes in (2026-11-17), by extension. Pure, so the page sorts its Files view
// with the same rule the server files them by (core/deliverable-files.ts). Sorting is not serving: svg sorts with images,
// but the proof route still never serves it (PROOF_TYPES).
export const FILE_KINDS = ["images", "videos", "artifacts"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
const VIDEO = new Set([".mp4", ".m4v", ".webm", ".mov"]);
const extOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

/** images, videos, or artifacts (markdown, text, html, pdf, json, logs, the rest). */
export function fileKind(path: string): FileKind {
  const ext = extOf(path);
  return IMAGE.has(ext) ? "images" : VIDEO.has(ext) ? "videos" : "artifacts";
}
