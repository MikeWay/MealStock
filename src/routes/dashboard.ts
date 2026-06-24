import { Router } from "express";
import { countContactNameIssues, loadContactsFromCache } from "../scraper/contacts.js";
import { loadConsentCache } from "../scraper/consents.js";
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
    nameIssues = countContactNameIssues(contacts);
  }

  const consentCache = loadConsentCache();
  const consentsGranted = consentCache
    ? consentCache.contacts.filter((c) => c.status === "consented").length
    : null;

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
