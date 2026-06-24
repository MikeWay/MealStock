import { Router } from "express";
import { getScmClient } from "../scraper/client.js";
import { addTagToContactInCache, clearContactsCache, fetchContacts, loadContactsFromCache } from "../scraper/contacts.js";
import { findDuplicateGroups } from "../scraper/duplicates.js";
import { mergeContacts, previewMerge } from "../scraper/merge.js";
import { prepareContactNamesImport, confirmContactNamesImport, cancelPendingImport, applyContactNamesFixes } from "../scraper/nameRepair.js";
import { addTagToContact } from "../scraper/tags.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = Router();

router.get("/api/contacts/duplicates", requirePermission("duplicates", "view"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res
        .status(401)
        .json({ success: false, message: "Not logged in to SCM" });
      return;
    }

    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      const contacts = await fetchContacts(page);
      const { definiteGroups, possibleGroups } = findDuplicateGroups(contacts);
      res.json({ totalContacts: contacts.length, definiteGroups, possibleGroups });
    } finally {
      await page.close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error fetching contacts";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/clear-cache", requirePermission("duplicates", "full"), (req, res) => {
  try {
    const removed = clearContactsCache();
    res.json({ success: true, message: `Cleared ${removed} cached file(s).` });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error clearing cache";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/merge/preview", requirePermission("duplicates", "full"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "Not logged in to SCM" });
      return;
    }
    const { primaryId, secondaryId, secondaryName } = req.body;
    if (!primaryId || !secondaryId || !secondaryName) {
      res.status(400).json({ success: false, message: "Missing required fields: primaryId, secondaryId, secondaryName" });
      return;
    }
    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      const result = await previewMerge(page, primaryId, secondaryId, secondaryName);
      res.json(result);
    } finally {
      await page.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error during merge preview";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/merge", requirePermission("duplicates", "full"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res
        .status(401)
        .json({ success: false, message: "Not logged in to SCM" });
      return;
    }

    const { primaryId, secondaryId, secondaryName } = req.body;
    if (!primaryId || !secondaryId || !secondaryName) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: primaryId, secondaryId, secondaryName",
      });
      return;
    }

    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      const result = await mergeContacts(page, primaryId, secondaryId, secondaryName);
      res.json(result);
    } finally {
      await page.close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during merge";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/mark-non-duplicate", requirePermission("duplicates", "full"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "Not logged in to SCM" });
      return;
    }
    const { contactId } = req.body;
    if (!contactId) {
      res.status(400).json({ success: false, message: "Missing contactId" });
      return;
    }
    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      await addTagToContact(page, String(contactId), "Not a Duplicate");
      addTagToContactInCache(String(contactId), "Not a Duplicate");
      res.json({ success: true });
    } finally {
      await page.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/import-names/prepare", requirePermission("duplicates", "full"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "Not logged in to SCM" });
      return;
    }
    const { csv } = req.body;
    if (!csv || typeof csv !== "string") {
      res.status(400).json({ success: false, message: "Missing csv field" });
      return;
    }
    const page = await getScmClient(req.session.userEmail!).getPage();
    // Note: page is intentionally NOT closed here — it is held open for the confirm step
    const result = await prepareContactNamesImport(page, csv);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error during import preparation";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/import-names/confirm", requirePermission("duplicates", "full"), async (req, res) => {
  try {
    const result = await confirmContactNamesImport();
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error during import";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/import-names/apply", requirePermission("duplicates", "full"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "Not logged in to SCM" });
      return;
    }
    const { csv } = req.body;
    if (!csv || typeof csv !== "string") {
      res.status(400).json({ success: false, message: "Missing csv field" });
      return;
    }
    const page = await getScmClient(req.session.userEmail!).getPage();
    const result = await applyContactNamesFixes(page, csv);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error during apply";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/contacts/import-names/cancel", requirePermission("duplicates", "full"), async (req, res) => {
  try {
    await cancelPendingImport();
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, message });
  }
});

router.get("/api/contacts/count-by-name", requirePermission("duplicates", "view"), (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.toLowerCase().trim() : "";
  const excludeId = typeof req.query.excludeId === "string" ? req.query.excludeId : "";
  const contacts = loadContactsFromCache() ?? [];
  const count = contacts.filter(c => c.name.toLowerCase().trim() === name && c.id !== excludeId).length;
  res.json({ count });
});

router.get("/api/contacts/name-issues", requirePermission("duplicates", "view"), async (req, res) => {
  let contacts = loadContactsFromCache();
  if (!contacts) {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "No cached contacts found. Connect to SCM first." });
      return;
    }
    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      contacts = await fetchContacts(page);
    } finally {
      await page.close();
    }
  }

  function toProperCase(value: string, isLastName: boolean): string {
    if (value.length === 0) return value;
    let s = value.toLowerCase();
    // Capitalise first character
    s = s[0].toUpperCase() + s.slice(1);
    // Capitalise letter after internal space
    s = s.replace(/ ([a-z])/g, (_m, c: string) => " " + c.toUpperCase());
    // Capitalise letter after hyphen
    s = s.replace(/-([a-z])/g, (_m, c: string) => "-" + c.toUpperCase());
    // Capitalise letter after apostrophe
    s = s.replace(/'([a-z])/g, (_m, c: string) => "'" + c.toUpperCase());
    // Mc / Mac prefix (last names only)
    if (isLastName) {
      s = s.replace(/^Mc([a-z])/, (_m, c: string) => "Mc" + c.toUpperCase());
      s = s.replace(/^Mac([a-z])/, (_m, c: string) => "Mac" + c.toUpperCase());
    }
    return s;
  }

  function checkName(value: string, isLastName: boolean): { currentValue: string; issues: string[]; suggested: string } | null {
    const issues: string[] = [];
    // Step 1: trim leading/trailing spaces first
    let suggested = value.trim();
    if (value !== suggested) {
      issues.push("leading/trailing spaces");
    }
    // Step 2: check capitalisation (including after internal spaces)
    if (suggested.length > 0) {
      const proper = toProperCase(suggested, isLastName);
      if (suggested !== proper) {
        issues.push("incorrect capitalisation");
        suggested = proper;
      }
    }

    return issues.length > 0 ? { currentValue: value, issues, suggested } : null;
  }

  const nameIssues = contacts
    .map((c) => ({
      id: c.id,
      name: c.name,
      originalFirstName: c.firstName,
      originalLastName: c.lastName,
      firstName: checkName(c.firstName, false),
      lastName: checkName(c.lastName, true),
    }))
    .filter((r) => r.firstName !== null || r.lastName !== null);

  res.json({ success: true, total: nameIssues.length, issues: nameIssues });
});

export default router;
