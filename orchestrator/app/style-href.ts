// React keeps one <style href> per href, so a bb window left open across an update keeps the old rules unless a
// changed block gets a new href. Deriving the href from the CSS text makes that automatic: no hand-bumped suffixes.
const seen = new Map<string, string>();

/** `<name>-<hash of css>`: the same CSS always gives the same href (two components sharing a block agree), a changed one a new href. */
export function styleHref(name: string, css: string): string {
  const key = `${name}\n${css}`;
  const hit = seen.get(key);
  if (hit) return hit;
  let h = 0x811c9dc5; // FNV-1a, 32-bit
  for (let i = 0; i < css.length; i++) {
    h ^= css.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const href = `${name}-${(h >>> 0).toString(36)}`;
  seen.set(key, href);
  return href;
}
