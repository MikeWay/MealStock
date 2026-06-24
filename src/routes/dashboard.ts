import { Router } from "express";
import { countContactNameIssues, loadContactsFromCache, loadIgnoredContacts } from "../scraper/contacts.js";
import { loadConsentCache, loadWithdrawals } from "../scraper/consents.js";
import { findDuplicateGroups } from "../scraper/duplicates.js";
import { getPrefetchData } from "../scraper/prefetch.js";
import { getJobsStatus } from "../scheduler/index.js";

const router = Router();

router.get("/api/dashboard/summary", (req, res) => {
  const contacts = loadContactsFromCache();

  let duplicates: number | null = null;
  let nameIssues: number | null = null;
  if (contacts) {
    const { definiteGroups, possibleGroups } = findDuplicateGroups(contacts);
    duplicates = definiteGroups.length + possibleGroups.length;
    const ignoredIds = new Set(loadIgnoredContacts().map(r => r.contactId));
    nameIssues = countContactNameIssues(contacts, ignoredIds);
  }

  const consentCache = loadConsentCache();
  let consentsGranted: number | null = null;
  if (consentCache) {
    const withdrawnIds = new Set(loadWithdrawals().map(w => w.contactId));
    consentsGranted = consentCache.contacts.filter(
      c => c.status === "consented" && !withdrawnIds.has(c.contactId)
    ).length;
  }

  const schedulerFailed = getJobsStatus().filter((j) => j.lastStatus === "failed").length;

  const prefetch = req.session.userEmail ? getPrefetchData(req.session.userEmail) : null;

  res.json({
    duplicates,
    nameIssues,
    consentsGranted,
    schedulerFailed,
    tasks: prefetch?.tasks ?? null,
    emailIssues: prefetch?.emailIssues ?? null,
  });
});

export default router;
