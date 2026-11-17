// An agent's Pokémon (mons.ts): the animated sprite, or the still one under prefers-reduced-motion (picked by the
// browser through <picture>, so no JS reads the setting). A fixed box from the first paint, so a sprite that loads late
// moves nothing (Needs you arms cards by position). An unknown mon or an image that fails falls back to the role avatar.
import { styleHref } from "./style-href.ts";
import { useState, type CSSProperties } from "react";
import { isShiny, monByName, monSprite } from "../mons.ts";
import { Avatar, type AvatarSize } from "./affect/avatar-clean.tsx";
import { ROLE_TONES, css, roleOf } from "./palette.ts";

/**
 * Pixel art stays crisp; a slow idle bob of 2 px, off under reduced motion. The box is the sprite's, the img fills it
 * (the still png has its own padding, the animated gif is cropped: `contain` keeps both whole).
 */
const MON_CSS = `
[data-orch] .orch-mon { display: inline-grid; place-items: center; flex: none; width: var(--mon); height: var(--mon); }
[data-orch] .orch-mon picture { display: contents; }
[data-orch] .orch-mon img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; animation: orch-mon-bob 3s ease-in-out infinite; }
@keyframes orch-mon-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { [data-orch] .orch-mon img { animation: none; } }
`;

const AVATAR_SIZES: readonly AvatarSize[] = [40, 32, 24, 20];

/** `size` is the box in px; the CoS's Rayquaza gets a quarter more, unless `boost` is off (a row it must line up in). */
export function MonSprite({ mon, address, size = 32, boost = true }: { mon: string | null | undefined; address: string; size?: 20 | 24 | 28 | 32 | 40; boost?: boolean }) {
  const m = monByName(mon);
  const role = roleOf(address);
  const box = role === "cos" && boost ? Math.round(size * 1.25) : size; // side by side with others, the same box
  const shiny = isShiny(role);
  const still = m ? monSprite(m, false, shiny) : null;
  const moving = m ? monSprite(m, true, shiny) : null;
  const [failed, setFailed] = useState<string | null>(null);
  const style = { "--mon": `${box}px` } as CSSProperties;
  const label = m ? `${shiny ? "Shiny " : ""}${m.name} · ${address}` : address;

  return (
    <span className="orch-mon" style={style} title={label} data-mon={m?.name ?? ""}>
      <style href={styleHref("orch-mon", MON_CSS)} precedence="default">
        {MON_CSS}
      </style>
      {m && moving && still && failed !== moving ? (
        <picture>
          <source srcSet={still} media="(prefers-reduced-motion: reduce)" />
          {/* each sprite bobs on its own phase, so a list doesn't move in step */}
          <img src={moving} alt={m.name} width={box} height={box} loading="lazy" decoding="async" draggable={false} style={{ animationDelay: `${-(m.dex % 7) * 0.43}s` }} onError={() => setFailed(moving)} />
        </picture>
      ) : (
        <Avatar kind="agent" seed={address} color={role ? css(ROLE_TONES[role]) : undefined} size={AVATAR_SIZES.find((s) => s <= box) ?? 20} aria-label={label} />
      )}
    </span>
  );
}
