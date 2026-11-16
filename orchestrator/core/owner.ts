// Who the orchestrator works for, in words. The ownerName setting names the person; without it, text an agent reads
// says "the owner" and text on the person's own screens says "you". No bb or zod import, so node --test checks it.

export type OwnerWords = {
  /** Mid-sentence: the set name or "the owner". Possessive: `${name}'s`. */
  name: string;
  /** At the start of a sentence: the set name or "The owner". */
  Name: string;
};

/** The owner as agents read it: the set name, else "the owner". */
export function ownerWords(ownerName: string | null | undefined): OwnerWords {
  const n = ownerName?.trim();
  return n ? { name: n, Name: n } : { name: "the owner", Name: "The owner" };
}

/** The owner as the person's own screens show it: the set name, else "you" ("You" at the start of a sentence). */
export function ownerOnScreen(ownerName: string | null | undefined): OwnerWords {
  const n = ownerName?.trim();
  return n ? { name: n, Name: n } : { name: "you", Name: "You" };
}

/** The CoS's display name: the cosTitle setting, else "Chief of Staff". */
export const cosTitleOf = (cosTitle: string | null | undefined): string => cosTitle?.trim() || "Chief of Staff";
