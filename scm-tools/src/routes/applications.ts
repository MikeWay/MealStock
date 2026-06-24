import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getScmClient } from "../scraper/client.js";
import { fetchApplications, type Application } from "../scraper/applications.js";

const router = Router();

const HEADERS: Array<keyof Application> = [
  "status", "name", "memberships", "period", "proposer", "seconder",
  "approver", "concession", "giftAid", "additionalMembers",
  "personalDetails", "confirmations", "consent", "supportingInformation",
];

const HEADER_LABELS: Record<keyof Application, string> = {
  status:                "Status",
  name:                  "Name",
  memberships:           "Memberships",
  period:                "Period",
  proposer:              "Proposer",
  seconder:              "Seconder",
  approver:              "Approver",
  concession:            "Concession",
  giftAid:               "Gift-Aid",
  additionalMembers:     "Additional Members",
  personalDetails:       "Personal Details",
  confirmations:         "Confirmations",
  consent:               "Consent",
  supportingInformation: "Supporting Information",
};

function csvRow(values: string[]): string {
  return values.map(v => {
    if (v.includes('"') || v.includes(",") || v.includes("\n") || v.includes("\r")) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }).join(",") + "\r\n";
}

router.get("/api/applications/export", requirePermission("users", "full"), async (req, res) => {
  if (!getScmClient(req.session.userEmail!).loggedIn) {
    res.status(401).json({ success: false, message: "Not logged in to SCM" });
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="applications-${date}.csv"`);

  // Write header row immediately so nginx sees an active response
  res.write(csvRow(HEADERS.map(h => HEADER_LABELS[h])));

  const page = await getScmClient(req.session.userEmail!).getPage();
  try {
    await fetchApplications(page, (app) => {
      res.write(csvRow(HEADERS.map(h => app[h])));
    });
  } finally {
    await page.close();
  }

  res.end();
});

export default router;
