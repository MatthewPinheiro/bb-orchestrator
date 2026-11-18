// app/ui (2026-11-17): shadcn/ui's components on bb's own tokens, the one component base every tab moves onto (LICENSE
// here says what was changed). bb's `bb plugin build` maps Radix's Dialog, AlertDialog, DropdownMenu, Select and Tooltip,
// react-dom, clsx, tailwind-merge and cva to bb's own copies at runtime (one React); the other Radix parts are bundled.
// Tab code never edits this folder: a missing component goes to the lead, who adds it here.
//
// Icons: lucide-react, shadcn's own, not the SDK's experimental_Icon. lucide's names are typed (a wrong one fails the
// typecheck), it is a stable release, and shadcn's parts already import it; experimental_Icon takes any string and
// falls back to a generic glyph for a name it doesn't know, so a gap would only show on screen. bb's built-in names
// ("Workflow", "Zap") are lucide's names too.
//
// Dark: bb's dark theme is the .dark class on <html>, set from bb's own setting (light, dark or system), and bb's own CSS
// keys off it. `bb plugin build` compiles a plugin's Tailwind with no way to say so, so a plain `dark:` follows the OS
// instead and is wrong whenever bb's setting and the OS differ (the destructive badge, white on a 60% red meant for the
// dark card, would sit on the light card at 3.7:1). So app/ui writes it `[&:is(.dark_*)]:`, the form bb's CSS compiles to.
//
// shadcn/ui's cn(): clsx for conditional classes, tailwind-merge so a caller's class wins over a component's default.
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * bb compiles the plugin's Tailwind under [data-bb-plugin="orchestrator"], so a Radix portal (rendered into body, outside
 * the panel) carries the same marks bb's own portaled overlays do. 2026-11-17: the only change to shadcn's portal parts.
 */
export const PORTAL = { "data-bb-portaled-overlay": "", "data-bb-plugin-root": "", "data-bb-plugin": "orchestrator" } as const
