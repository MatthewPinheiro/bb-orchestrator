// Screenshots in the owner's message boxes (2026-11-17): the attach button, the row of thumbnails with their remove
// buttons, the refusal line and the drop zone, shared by the composer to a lead (direct-line.tsx, the Projects and Scope
// boxes) and the bar to the CoS (cos-composer.tsx). Which files are taken is lead-images.ts admit; each box keeps its
// own list. The thumbnails are the files' object URLs; nothing here reads or logs their bytes except base64, for the write.
import { useRef, useState, type DragEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { ACCEPT } from "./lead-images.ts";
import { styleHref } from "./style-href.ts";
import { Button } from "./ui/button.tsx";

/** A screenshot on a draft: the file, its preview's object URL, and the server's id once it was staged. */
export type Attached = { key: string; file: File; url: string; id: string | null };
let seq = 0;
export const attached = (file: File): Attached => ({ key: `a${++seq}`, file, url: URL.createObjectURL(file), id: null });

/** A file's bytes as base64, for the image write (bb's local routes take JSON only). Never logged. */
export const base64 = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

export const imagesCss = /* css */ `
[data-orch] .k-images { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 4px 0 0; list-style: none; }
[data-orch] .k-thumb { position: relative; width: 64px; height: 64px; }
[data-orch] .k-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; border: 1px solid var(--border); border-radius: calc(var(--radius, 8px) - 2px); }
[data-orch] .k-thumb__remove { position: absolute; top: -8px; right: -8px; border-radius: 9999px; }
[data-orch] .k-images-refused { margin: 0; font-size: 12px; line-height: 16px; color: var(--destructive); }
[data-orch] [data-dropping] { outline: 2px dashed var(--muted-foreground); outline-offset: -6px; }
`;

/** The 24 px attach button, and the hidden file picker it opens (the four accepted types, several at once). */
export function AttachButton({ onFiles, disabled, data }: { onFiles: (files: File[]) => void; disabled?: boolean; data: Record<`data-${string}`, string> }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Attach images" title="Attach images (or paste or drop screenshots)" disabled={disabled} onClick={() => picker.current?.click()} {...data}>
        <ImagePlus aria-hidden />
      </Button>
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );
}

/** The attached images as thumbnails, each with its labelled 24 px remove button; then why a file stayed out, if one did. */
export function ImageThumbs({ images, refused, onRemove, disabled, className, data }: { images: readonly Attached[]; refused: string | null; onRemove: (key: string) => void; disabled?: boolean; className?: string; data: string }) {
  return (
    <>
      <style href={styleHref("orch-images", imagesCss)} precedence="default">
        {imagesCss}
      </style>
      {images.length ? (
        <ul className={className ? `k-images ${className}` : "k-images"} aria-label="Attached images" data-images={data}>
          {images.map((i) => (
            <li key={i.key} className="k-thumb" data-direct-thumb={i.key}>
              <img src={i.url} alt={i.file.name || "Pasted image"} />
              <Button type="button" variant="secondary" size="icon-xs" className="k-thumb__remove" aria-label={`Remove ${i.file.name || "image"}`} title="Remove" data-direct-remove={i.key} disabled={disabled} onClick={() => onRemove(i.key)}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {refused ? (
        <p className={className ? `k-images-refused ${className}` : "k-images-refused"} role="alert" data-image-refused="">
          {refused}
        </p>
      ) : null}
    </>
  );
}

/** A box files can be dropped on: its handlers, and whether a file is over it now (the box shows a dashed ring). */
export function useDrop(onFiles: (files: File[]) => void) {
  const [dropping, setDropping] = useState(false);
  const files = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return {
    "data-dropping": dropping || undefined,
    onDragOver: (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropping(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      setDropping(false);
      onFiles(Array.from(e.dataTransfer.files));
    },
  };
}
