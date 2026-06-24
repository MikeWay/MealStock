import { EventEmitter } from "events";
import { Router } from "express";
import { fetchContacts } from "../scraper/contacts.js";
import {
  clearConsentCache,
  fetchAllConsents,
  isConsentCacheFresh,
  loadConsentCache,
  loadWithdrawals,
  recordWithdrawal,
  removeWithdrawal,
  saveConsentCache,
  type ConsentCache,
  type ContactConsentRecord,
} from "../scraper/consents.js";
import { getScmClient } from "../scraper/client.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = Router();
router.use(requirePermission("consents", "view"));
const scanEmitter = new EventEmitter();
let scanRunning = false;
let scanCancelled = false;

type ReportStatus = "consented" | "not_consented" | "no_record" | "withdrawn";

interface ConsentReportRow {
  contactId: string;
  name: string;
  email: string;
  status: ReportStatus;
  withdrawnAt?: string;
}

function applyWithdrawals(contacts: ContactConsentRecord[]): ConsentReportRow[] {
  const withdrawals = loadWithdrawals();
  const withdrawalMap = new Map(withdrawals.map((w) => [w.contactId, w.withdrawnAt]));
  return contacts.map((c) => {
    const withdrawnAt = withdrawalMap.get(c.contactId);
    return {
      ...c,
      status: withdrawnAt ? "withdrawn" : c.status,
      withdrawnAt,
    };
  });
}

router.get("/api/consents", (req, res) => {
  const cache = loadConsentCache();
  if (!cache) {
    res.json({ status: "not_ready" });
    return;
  }
  const contacts = applyWithdrawals(cache.contacts);
  res.json({
    status: "ok",
    scannedAt: cache.scannedAt,
    fresh: isConsentCacheFresh(cache),
    scanRunning,
    contacts,
  });
});

router.post("/api/consents/scan", async (req, res) => {
  if (scanRunning) {
    res.json({ success: false, message: "Scan already in progress" });
    return;
  }
  if (!getScmClient(req.session.userEmail!).loggedIn) {
    res.status(401).json({ success: false, message: "Not logged in to SCM" });
    return;
  }

  res.json({ success: true, message: "Scan started" });

  scanRunning = true;
  scanCancelled = false;
  (async () => {
    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      const contacts = await fetchContacts(page);

      const consentMap = await fetchAllConsents(
        page,
        (done, total, name) => { scanEmitter.emit("progress", { done, total, contact: name }); },
        () => scanCancelled
      );

      const results: ContactConsentRecord[] = contacts.map((c) => ({
        contactId: c.id,
        name: c.name,
        email: c.email,
        status: consentMap.get(c.id) ?? "no_record",
      }));

      const cache: ConsentCache = { scannedAt: new Date().toISOString(), contacts: results };
      saveConsentCache(cache);
      scanEmitter.emit("complete", { total: results.length });
    } catch (err) {
      if (err instanceof Error && err.message === "__cancelled__") {
        scanEmitter.emit("cancelled", {});
      } else {
        const message = err instanceof Error ? err.message : "Unknown error during scan";
        scanEmitter.emit("error", { message });
      }
    } finally {
      await page.close();
      scanRunning = false;
      scanCancelled = false;
    }
  })();
});

router.get("/api/consents/scan/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!scanRunning) {
    res.write(`data: ${JSON.stringify({ notRunning: true })}\n\n`);
    res.end();
    return;
  }

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const onProgress = (data: object) => send(data);
  const onComplete = (data: object) => { send({ ...data, complete: true }); res.end(); cleanup(); };
  const onError = (data: object) => { send({ ...data, isError: true }); res.end(); cleanup(); };
  const onCancelled = () => { send({ cancelled: true }); res.end(); cleanup(); };

  // Keep the connection alive during long polling phases
  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15_000);

  function cleanup() {
    clearInterval(keepAlive);
    scanEmitter.off("progress", onProgress);
    scanEmitter.off("complete", onComplete);
    scanEmitter.off("error", onError);
    scanEmitter.off("cancelled", onCancelled);
  }

  scanEmitter.on("progress", onProgress);
  scanEmitter.on("complete", onComplete);
  scanEmitter.on("error", onError);
  scanEmitter.on("cancelled", onCancelled);
  req.on("close", cleanup);
});

router.post("/api/consents/scan/cancel", (_req, res) => {
  if (!scanRunning) {
    res.json({ success: false, message: "No scan in progress" });
    return;
  }
  scanCancelled = true;
  res.json({ success: true });
});

router.post("/api/consents/withdraw", requirePermission("consents", "full"), (req, res) => {
  const { contactId, contactName } = req.body as { contactId?: string; contactName?: string };
  if (!contactId || !contactName) {
    res.status(400).json({ success: false, message: "Missing contactId or contactName" });
    return;
  }
  const { record, alreadyExisted } = recordWithdrawal(contactId, contactName);
  res.json({ success: true, alreadyExisted, withdrawnAt: record.withdrawnAt });
});

router.post("/api/consents/undo-withdrawal", requirePermission("consents", "full"), (req, res) => {
  const { contactId } = req.body as { contactId?: string };
  if (!contactId) {
    res.status(400).json({ success: false, message: "Missing contactId" });
    return;
  }
  const result = removeWithdrawal(contactId);
  res.json(result);
});

router.post("/api/consents/clear-cache", requirePermission("consents", "full"), (_req, res) => {
  clearConsentCache();
  res.json({ success: true, message: "Consent cache cleared." });
});

export default router;
