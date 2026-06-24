import { EventEmitter } from "events";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getScmClient } from "../scraper/client.js";
import { fetchContacts, loadContactsFromCache, removeContactFromCache } from "../scraper/contacts.js";
import { findDuplicateGroups } from "../scraper/duplicates.js";
import { mergeContacts } from "../scraper/merge.js";
import {
  addRule, deleteRule, getRuleFailedConditions, loadRules, ruleMatches, selectPrimaryIdx, updateRule,
  RULE_FIELDS, RULE_OPERATORS,
  type MergeRule, type RuleCondition, type RuleField, type RuleOperator, type RulePrimarySelection,
} from "../scraper/autoMergeRules.js";

const router = Router();
const perm = requirePermission("duplicates", "full");

const VALID_FIELDS = new Set<string>(RULE_FIELDS);
const VALID_OPERATORS = new Set<string>(RULE_OPERATORS);
const VALID_PRIMARY: Set<string> = new Set(["suggested", "active_first", "older_first"]);

function validateRule(body: unknown): { name: string; enabled: boolean; conditions: MergeRule["conditions"]; primarySelection: RulePrimarySelection } | string {
  if (!body || typeof body !== "object") return "Body must be an object";
  const b = body as Record<string, unknown>;
  if (!b.name || typeof b.name !== "string" || !b.name.trim()) return "name is required";
  if (!Array.isArray(b.conditions) || b.conditions.length === 0) return "conditions must be a non-empty array";
  for (const c of b.conditions) {
    if (!c || typeof c !== "object") return "each condition must be an object";
    const co = c as Record<string, unknown>;
    if (!VALID_FIELDS.has(String(co.field))) return `unknown field: ${co.field}`;
    if (!VALID_OPERATORS.has(String(co.operator))) return `unknown operator: ${co.operator}`;
  }
  const ps = b.primarySelection ?? "suggested";
  if (!VALID_PRIMARY.has(String(ps))) return `unknown primarySelection: ${ps}`;
  return {
    name: (b.name as string).trim(),
    enabled: b.enabled !== false,
    conditions: b.conditions as MergeRule["conditions"],
    primarySelection: ps as RulePrimarySelection,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

router.get("/api/contacts/auto-merge/rules", perm, (_req, res) => {
  res.json({ rules: loadRules() });
});

router.post("/api/contacts/auto-merge/rules", perm, (req, res) => {
  const result = validateRule(req.body);
  if (typeof result === "string") { res.status(400).json({ success: false, message: result }); return; }
  const rule = addRule(result);
  res.json({ success: true, rule });
});

router.put("/api/contacts/auto-merge/rules/:id", perm, (req, res) => {
  const result = validateRule(req.body);
  if (typeof result === "string") { res.status(400).json({ success: false, message: result }); return; }
  const rule = updateRule(String(req.params.id), result);
  if (!rule) { res.status(404).json({ success: false, message: "Rule not found" }); return; }
  res.json({ success: true, rule });
});

router.delete("/api/contacts/auto-merge/rules/:id", perm, (req, res) => {
  const ok = deleteRule(String(req.params.id));
  if (!ok) { res.status(404).json({ success: false, message: "Rule not found" }); return; }
  res.json({ success: true });
});

// ── Preview ───────────────────────────────────────────────────────────────────

router.get("/api/contacts/auto-merge/preview", perm, (_req, res) => {
  const contacts = loadContactsFromCache();
  if (!contacts) {
    res.status(404).json({ success: false, message: "No contacts cache. Load contacts first." });
    return;
  }
  const { definiteGroups, possibleGroups } = findDuplicateGroups(contacts);
  const groups = [...definiteGroups, ...possibleGroups];
  const rules = loadRules();

  const wouldMerge: Array<{ ruleName: string; primaryName: string; secondaryName: string; primaryId: string; secondaryId: string }> = [];
  const skipped: Array<{ contactA: string; contactB: string; reason: string; ruleDetails?: Array<{ ruleName: string; failedConditions: RuleCondition[] }> }> = [];

  for (const group of groups) {
    if (group.contacts.length !== 2) {
      skipped.push({ contactA: group.contacts[0].name, contactB: group.contacts.slice(1).map(c => c.name).join(", "), reason: "group has 3+ contacts; manual review required" });
      continue;
    }
    const [a, b] = group.contacts;
    const matchedRule = rules.find(r => ruleMatches(r, a, b));
    if (!matchedRule) {
      const ruleDetails = rules
        .filter(r => r.enabled)
        .map(r => ({
          ruleName: r.name,
          failedConditions: getRuleFailedConditions(r, a, b) as RuleCondition[],
        }));
      skipped.push({ contactA: a.name, contactB: b.name, reason: "no rule matched", ruleDetails });
      continue;
    }
    const primaryIdx = selectPrimaryIdx(matchedRule, group);
    const secondaryIdx = 1 - primaryIdx;
    wouldMerge.push({
      ruleName: matchedRule.name,
      primaryName: group.contacts[primaryIdx].name,
      secondaryName: group.contacts[secondaryIdx].name,
      primaryId: group.contacts[primaryIdx].id,
      secondaryId: group.contacts[secondaryIdx].id,
    });
  }

  res.json({ success: true, wouldMerge, skipped });
});

// ── Run + SSE ─────────────────────────────────────────────────────────────────

const autoMergeEmitter = new EventEmitter();
let autoMergeRunning = false;

router.post("/api/contacts/auto-merge/run", perm, async (req, res) => {
  if (!getScmClient(req.session.userEmail!).loggedIn) {
    res.status(401).json({ success: false, message: "Not logged in to SCM" });
    return;
  }
  if (autoMergeRunning) {
    res.status(409).json({ success: false, message: "Auto-merge already running" });
    return;
  }

  res.json({ success: true });
  autoMergeRunning = true;
  const userEmail = req.session.userEmail!;

  (async () => {
    try {
      const contactPage = await getScmClient(userEmail).getPage();
      let contacts;
      try {
        contacts = await fetchContacts(contactPage);
      } finally {
        await contactPage.close();
      }

      const { definiteGroups, possibleGroups } = findDuplicateGroups(contacts);
      const groups = [...definiteGroups, ...possibleGroups];
      const groupTotal = groups.length;

      const mergedDetails: Array<{ ruleName: string; primaryName: string; secondaryName: string }> = [];
      const skipped: Array<{ contactA: string; contactB: string; reason: string }> = [];

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupIndex = i + 1;
        const [a, b] = group.contacts;

        if (group.contacts.length !== 2) {
          skipped.push({ contactA: a.name, contactB: group.contacts.slice(1).map(c => c.name).join(", "), reason: "group has 3+ contacts; manual review required" });
          continue;
        }

        autoMergeEmitter.emit("progress", { phase: "evaluating", groupIndex, groupTotal, contactA: a.name, contactB: b.name });

        const rules = loadRules();
        const matchedRule = rules.find(r => ruleMatches(r, a, b));
        if (!matchedRule) {
          skipped.push({ contactA: a.name, contactB: b.name, reason: "no rule matched" });
          continue;
        }

        const primaryIdx = selectPrimaryIdx(matchedRule, group);
        const secondaryIdx = 1 - primaryIdx;
        const primary = group.contacts[primaryIdx];
        const secondary = group.contacts[secondaryIdx];

        autoMergeEmitter.emit("progress", {
          phase: "merging",
          ruleName: matchedRule.name,
          groupIndex,
          groupTotal,
          primaryName: primary.name,
          secondaryName: secondary.name,
        });

        const mergePage = await getScmClient(userEmail).getPage();
        try {
          const result = await mergeContacts(mergePage, primary.id, secondary.id, secondary.name);
          if (result.success) {
            mergedDetails.push({ ruleName: matchedRule.name, primaryName: primary.name, secondaryName: secondary.name });
            removeContactFromCache(secondary.id);
          } else {
            skipped.push({ contactA: a.name, contactB: b.name, reason: result.message });
          }
        } finally {
          await mergePage.close();
        }
      }

      autoMergeEmitter.emit("done", {
        phase: "done",
        merged: mergedDetails.length,
        mergedDetails,
        skipped,
        done: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      autoMergeEmitter.emit("error", { phase: "error", message });
    } finally {
      autoMergeRunning = false;
    }
  })();
});

router.get("/api/contacts/auto-merge/progress", perm, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!autoMergeRunning) {
    res.write(`data: ${JSON.stringify({ notRunning: true })}\n\n`);
    res.end();
    return;
  }

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const onProgress = (data: object) => send(data);
  const onDone = (data: object) => { send(data); res.end(); cleanup(); };
  const onError = (data: object) => { send(data); res.end(); cleanup(); };
  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15_000);

  function cleanup() {
    clearInterval(keepAlive);
    autoMergeEmitter.off("progress", onProgress);
    autoMergeEmitter.off("done", onDone);
    autoMergeEmitter.off("error", onError);
  }

  autoMergeEmitter.on("progress", onProgress);
  autoMergeEmitter.on("done", onDone);
  autoMergeEmitter.on("error", onError);
  req.on("close", cleanup);
});

export default router;
