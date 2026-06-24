import { Router } from "express";
import { CronExpressionParser } from "cron-parser";
import { getJobsStatus, runJobByName } from "../scheduler/index.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = Router();

router.get("/api/scheduler/jobs", requirePermission("users", "view"), (_req, res) => {
  const jobs = getJobsStatus().map(j => ({
    ...j,
    nextRun: CronExpressionParser.parse(j.cronExpression).next().toDate().toISOString(),
  }));
  res.json(jobs);
});

router.post("/api/scheduler/jobs/:name/run", requirePermission("users", "full"), async (req, res) => {
  try {
    await runJobByName(String(req.params.name));
    res.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "already running" ? 409 : message === "not found" ? 404 : 500;
    res.status(status).json({ message });
  }
});

export default router;
