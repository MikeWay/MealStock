import { Router } from "express";
import { getScmClient } from "../scraper/client.js";
import { fetchAttentionItems } from "../scraper/tasks.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = Router();

router.get("/api/tasks", requirePermission("tasks", "view"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res
        .status(401)
        .json({ success: false, message: "Not logged in to SCM" });
      return;
    }

    const page = await getScmClient(req.session.userEmail!).getPage();
    try {
      const items = await fetchAttentionItems(page);
      res.json(items);
    } finally {
      await page.close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error fetching tasks";
    res.status(500).json({ success: false, message });
  }
});

export default router;
