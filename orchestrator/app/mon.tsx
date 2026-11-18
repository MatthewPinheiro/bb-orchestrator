// An agent's Pokémon (mons.ts): the animated sprite, or the still one under prefers-reduced-motion (picked by the
// browser through <picture>, so no JS reads the setting). A fixed box from the first paint, so a sprite that loads late
// moves nothing (Needs you arms cards by position). An unknown mon or an image that fails falls back to the role avatar.
// 2026-11-17: the box is shadcn's Avatar (app/ui) in its sprite variant (contained, pixelated, unclipped, bobbing); the
// fallback is the Avatar's neutral initial of the role.
import { styleHref } from "./style-href.ts";
import { useState, type CSSProperties } from "react";
import { isShiny, monByName, monSprite } from "../mons.ts";
import { Avatar, AvatarFallback } from "./ui/avatar.tsx";
import { ROLE_TONES, roleOf } from "./palette.ts";

/**
 * The box is the sprite's (any size, the CoS's boosted one too), inline-level as before; the Avatar's sprite variant draws
 * the image in it (the still png has its own padding, the animated gif is cropped: `contain` keeps both whole).
 */
const MON_CSS = `
[data-orch] .orch-mon { flex: none; }
`;

const AVATAR_SIZES = [16, 20, 24, 32, 40, 48] as const;

/** `size` is the box in px; the CoS's Rayquaza gets a quarter more, unless `boost` is off (a row it must line up in). */
export function MonSprite({ mon, address, size = 32, boost = true }: { mon: string | null | undefined; address: string; size?: 16 | 20 | 24 | 28 | 32 | 40 | 48; boost?: boolean }) {
  const m = monByName(mon);
  const role = roleOf(address);
  const box = role === "cos" && boost ? Math.round(size * 1.25) : size; // side by side with others, the same box
  const shiny = isShiny(role);
  const still = m ? monSprite(m, false, shiny) : null;
  const moving = m ? monSprite(m, true, shiny) : null;
  const [failed, setFailed] = useState<string | null>(null);
  const style = { "--mon": `${box}px`, width: box, height: box } as CSSProperties; // inline, so the box holds outside [data-orch] too
  const label = m ? `${shiny ? "Shiny " : ""}${m.name} · ${address}` : address;

  const named = AVATAR_SIZES.find((x) => x === box);

  return (
    <Avatar variant="sprite" className="orch-mon inline-flex align-middle" size={named ? (String(named) as `${typeof named}`) : "default"} style={style} title={label} data-mon={m?.name ?? ""}>
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
        <AvatarFallback aria-label={label} className="font-medium">
          {role ? ROLE_TONES[role].label.slice(0, 1).toUpperCase() : "?"}
        </AvatarFallback>
      )}
    </Avatar>
  );
}
