import { Router } from "express";
import { getScmClient } from "../scraper/client.js";
import { fetchEmailIssues, resetEmailIssues } from "../scraper/emailIssues.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = Router();

router.get("/api/email-issues", requirePermission("emailIssues", "view"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "Not logged in to SCM" });
      return;
    }
    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      const issues = await fetchEmailIssues(page);
      res.json(issues);
    } finally {
      await page.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error fetching email issues";
    res.status(500).json({ success: false, message });
  }
});

router.post("/api/email-issues/reset", requirePermission("emailIssues", "full"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "Not logged in to SCM" });
      return;
    }
    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      const count = await resetEmailIssues(page);
      res.json({ success: true, message: `Reset ${count} contact(s).` });
    } finally {
      await page.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error resetting email issues";
    res.status(500).json({ success: false, message });
  }
});

export default router;
