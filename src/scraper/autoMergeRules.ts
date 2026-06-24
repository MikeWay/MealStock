import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { Contact } from "./contacts.js";
import type { DuplicateGroup } from "./duplicates.js";

export type RuleField =
  | "email" | "phone" | "name" | "firstName" | "lastName"
  | "address" | "dob" | "membershipStatus";

export type RuleOperator =
  | "same" | "one_empty" | "both_empty" | "both_present" | "no_conflict";

export type RulePrimarySelection = "suggested" | "active_first" | "older_first";

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
}

export interface MergeRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  primarySelection: RulePrimarySelection;
}

export const RULE_FIELDS: RuleField[] = [
  "email", "phone", "name", "firstName", "lastName",
  "address", "dob", "membershipStatus",
];

export const RULE_OPERATORS: RuleOperator[] = [
  "same", "one_empty", "both_empty", "both_present", "no_conflict",
];

export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  same:         "same value (both non-empty)",
  one_empty:    "one is empty",
  both_empty:   "both are empty",
  both_present: "both have a value",
  no_conflict:  "no conflict (same or at least one empty)",
};

const CACHE_DIR = ".cache";
const RULES_FILE = path.join(CACHE_DIR, "auto-merge-rules.json");

export function loadRules(): MergeRule[] {
  if (!existsSync(RULES_FILE)) return [];
  try { return JSON.parse(readFileSync(RULES_FILE, "utf-8")) as MergeRule[]; }
  catch { return []; }
}

export function saveRules(rules: MergeRule[]): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf-8");
}

export function addRule(rule: Omit<MergeRule, "id">): MergeRule {
  const rules = loadRules();
  const newRule: MergeRule = { id: crypto.randomUUID(), ...rule };
  rules.push(newRule);
  saveRules(rules);
  return newRule;
}

export function updateRule(id: string, updates: Omit<MergeRule, "id">): MergeRule | null {
  const rules = loadRules();
  const idx = rules.findIndex(r => r.id === id);
  if (idx < 0) return null;
  rules[idx] = { id, ...updates };
  saveRules(rules);
  return rules[idx];
}

export function deleteRule(id: string): boolean {
  const rules = loadRules();
  const idx = rules.findIndex(r => r.id === id);
  if (idx < 0) return false;
  rules.splice(idx, 1);
  saveRules(rules);
  return true;
}

function normalizePhone(val: string): string {
  const digits = val.replace(/[\s\-()+]+/g, "");
  // Treat leading 0 as +44 (UK local → international)
  return digits.startsWith("0") ? "44" + digits.slice(1) : digits;
}

function getFieldValue(contact: Contact, field: RuleField): string {
  const raw = contact[field as keyof Contact];
  const val = Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
  return field === "email"
    ? val.toLowerCase().trim()
    : field === "phone"
      ? normalizePhone(val)
      : val.trim().toLowerCase();
}

export function evaluateCondition(a: Contact, b: Contact, cond: RuleCondition): boolean {
  const va = getFieldValue(a, cond.field);
  const vb = getFieldValue(b, cond.field);
  switch (cond.operator) {
    case "same":         return !!va && !!vb && va === vb;
    case "one_empty":    return (!va) !== (!vb);
    case "both_empty":   return !va && !vb;
    case "both_present": return !!va && !!vb;
    case "no_conflict":  return !va || !vb || va === vb;
  }
}

export function ruleMatches(rule: MergeRule, a: Contact, b: Contact): boolean {
  return rule.enabled && rule.conditions.every(c => evaluateCondition(a, b, c));
}

export function getRuleFailedConditions(rule: MergeRule, a: Contact, b: Contact): RuleCondition[] {
  return rule.conditions.filter(c => !evaluateCondition(a, b, c));
}

export function selectPrimaryIdx(rule: MergeRule, group: DuplicateGroup): number {
  const [a, b] = group.contacts;
  switch (rule.primarySelection) {
    case "active_first": {
      const aActive = a.membershipStatus?.toLowerCase() === "active";
      const bActive = b.membershipStatus?.toLowerCase() === "active";
      if (aActive && !bActive) return 0;
      if (bActive && !aActive) return 1;
      return group.suggestedPrimaryIdx;
    }
    case "older_first": {
      const aId = parseInt(a.id, 10);
      const bId = parseInt(b.id, 10);
      if (!isNaN(aId) && !isNaN(bId)) return aId < bId ? 0 : 1;
      return group.suggestedPrimaryIdx;
    }
    default:
      return group.suggestedPrimaryIdx;
  }
}
