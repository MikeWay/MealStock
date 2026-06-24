import type { Contact } from "./contacts.js";

export type { Contact };

export interface DuplicateGroup {
  contacts: Contact[];
  suggestedPrimaryIdx: number;
  reason?: string;
}

export interface DuplicateResult {
  definiteGroups: DuplicateGroup[];
  possibleGroups: DuplicateGroup[];
}

function bigrams(s: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.slice(i, i + 2));
  }
  return result;
}

export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function normalisePhone(phone: string): string {
  return phone.replace(/[\s\-()]+/g, "");
}

function hasNoContactInfo(c: Contact): boolean {
  return !c.email && !c.phone && !c.address;
}

function haveDobConflict(a: Contact, b: Contact): boolean {
  return !!a.dob && !!b.dob && a.dob !== b.dob;
}

function isDefiniteGroup(contacts: Contact[]): boolean {
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i];
      const b = contacts[j];

      // Different dates of birth means they are not the same person
      if (haveDobConflict(a, b)) continue;

      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
        return true;
      }

      if (a.phone && b.phone && normalisePhone(a.phone) === normalisePhone(b.phone)) {
        return true;
      }

      if (hasNoContactInfo(a) || hasNoContactInfo(b)) {
        return true;
      }
    }
  }
  return false;
}

function areNamesSimilar(
  a: Contact,
  b: Contact,
  normFirst: string[],
  normLast: string[],
  idxA: number,
  idxB: number,
  lastNameThreshold: number,
  firstNameThreshold: number
): boolean {
  const la = normLast[idxA];
  const lb = normLast[idxB];
  if (la === lb + "s" || lb === la + "s") return false;
  const [shorter, longer] = la.length <= lb.length ? [la, lb] : [lb, la];
  if (longer.startsWith(shorter) && longer.length - shorter.length >= 2) return false;

  const lastSim = diceCoefficient(la, lb);
  if (lastSim < lastNameThreshold) return false;

  const firstSim = diceCoefficient(normFirst[idxA], normFirst[idxB]);
  return firstSim >= firstNameThreshold;
}

function buildPossibleReason(a: Contact, b: Contact): string {
  const lastSim = diceCoefficient(normalise(a.lastName), normalise(b.lastName));
  const firstSim = diceCoefficient(normalise(a.firstName), normalise(b.firstName));

  const nameDesc = lastSim >= 0.99 && firstSim >= 0.99
    ? "identical names"
    : lastSim >= 0.99
    ? "same last name with a similar first name"
    : "similar names";

  const conflicts: string[] = [];
  if (a.email && b.email && a.email.toLowerCase() !== b.email.toLowerCase()) {
    conflicts.push("different email addresses");
  }
  if (a.phone && b.phone && normalisePhone(a.phone) !== normalisePhone(b.phone)) {
    conflicts.push("different phone numbers");
  }

  if (conflicts.length > 0) {
    return `Matched by ${nameDesc}, but have ${conflicts.join(" and ")} — verify before merging`;
  }
  return `Matched by ${nameDesc} with no shared contact details to confirm identity`;
}

function hasNonDuplicateTag(c: Contact): boolean {
  return c.tags.some((t) => {
    const lower = t.toLowerCase();
    return lower === "not a duplicate" || lower === "non duplicate";
  });
}

function isActiveMember(c: Contact): boolean {
  if (c.membershipStatus && c.membershipStatus.toLowerCase() === "active") return true;
  if (c.membershipEnd) {
    const end = new Date(c.membershipEnd);
    if (!isNaN(end.getTime()) && end >= new Date()) return true;
  }
  return false;
}

function dataScore(c: Contact): number {
  return [c.email, c.phone, c.address, c.dob, c.membershipStatus].filter(Boolean).length;
}

export function suggestPrimaryIndex(contacts: Contact[]): number {
  if (contacts.length < 2) return 0;
  const [a, b] = contacts;

  const aActive = isActiveMember(a);
  const bActive = isActiveMember(b);

  // Rule 1: prefer the contact with an active membership
  if (aActive && !bActive) return 0;
  if (bActive && !aActive) return 1;

  // Rule 2: both/neither active — prefer older record (lower numeric ID)
  const aId = parseInt(a.id, 10);
  const bId = parseInt(b.id, 10);
  if (!isNaN(aId) && !isNaN(bId) && aId !== bId) return aId < bId ? 0 : 1;

  // Rule 3: more data wins
  return dataScore(a) >= dataScore(b) ? 0 : 1;
}

export function findDuplicateGroups(
  contacts: Contact[],
  lastNameThreshold = 0.85,
  firstNameThreshold = 0.7
): DuplicateResult {
  // Exclude contacts tagged as "Not a Duplicate" (or legacy "Non Duplicate")
  contacts = contacts.filter((c) => !hasNonDuplicateTag(c));
  const n = contacts.length;

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    parent[find(a)] = find(b);
  }

  const normFirst = contacts.map((c) => normalise(c.firstName));
  const normLast = contacts.map((c) => normalise(c.lastName));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        !haveDobConflict(contacts[i], contacts[j]) &&
        areNamesSimilar(
          contacts[i], contacts[j],
          normFirst, normLast, i, j,
          lastNameThreshold, firstNameThreshold
        )
      ) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const definiteGroups: DuplicateGroup[] = [];
  const possibleGroups: DuplicateGroup[] = [];

  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const groupContacts = indices.map((i) => contacts[i]);

    const suggestedPrimaryIdx = suggestPrimaryIndex(groupContacts);
    if (isDefiniteGroup(groupContacts)) {
      definiteGroups.push({ contacts: groupContacts, suggestedPrimaryIdx });
    } else {
      const reason = groupContacts.length === 2
        ? buildPossibleReason(groupContacts[0], groupContacts[1])
        : "Matched by name similarity only";
      possibleGroups.push({ contacts: groupContacts, suggestedPrimaryIdx, reason });
    }
  }

  return { definiteGroups, possibleGroups };
}
