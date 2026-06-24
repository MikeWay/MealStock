import { schedule } from "node-cron";
import { sendEmail } from "../email.js";
import { ALERT_EMAIL } from "../config.js";
import * as ftpEnable from "./jobs/ftpEnable.js";

interface Job {
  name: string;
  cronExpression: string;
  run: () => Promise<void>;
}

export interface JobStatus {
  name: string;
  cronExpression: string;
  lastRun: string | null;
  lastStatus: "ok" | "failed" | "running" | null;
}

const jobs: Job[] = [
  { name: ftpEnable.name, cronExpression: ftpEnable.cronExpression, run: ftpEnable.run },
];

const running = new Set<string>();
const statusMap = new Map<string, JobStatus>();

async function executeJob(job: Job): Promise<void> {
  if (running.has(job.name)) {
    console.log(`[scheduler] ${job.name}: already running, skipping`);
    throw new Error("already running");
  }
  running.add(job.name);
  const status = statusMap.get(job.name)!;
  status.lastStatus = "running";
  try {
    console.log(`[scheduler] ${job.name}: starting`);
    await job.run();
    status.lastRun = new Date().toISOString();
    status.lastStatus = "ok";
    console.log(`[scheduler] ${job.name}: OK`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.lastRun = new Date().toISOString();
    status.lastStatus = "failed";
    console.error(`[scheduler] ${job.name}: FAILED —`, message);
    if (ALERT_EMAIL) {
      await sendEmail({
        to: ALERT_EMAIL,
        subject: `[scm-tools] Job failed: ${job.name}`,
        text: `The scheduled job "${job.name}" failed with the following error:\n\n${message}`,
      }).catch((e) => console.error(`[scheduler] failed to send alert email:`, e));
    }
    throw err;
  } finally {
    running.delete(job.name);
  }
}

export function registerJobs(): void {
  for (const job of jobs) {
    statusMap.set(job.name, { name: job.name, cronExpression: job.cronExpression, lastRun: null, lastStatus: null });
    schedule(job.cronExpression, () => executeJob(job).catch(() => {}));
    console.log(`[scheduler] registered: ${job.name} (${job.cronExpression})`);
  }
}

export function getJobsStatus(): JobStatus[] {
  return jobs.map(j => ({ ...statusMap.get(j.name)! }));
}

export async function runJobByName(name: string): Promise<void> {
  const job = jobs.find(j => j.name === name);
  if (!job) throw new Error("not found");
  await executeJob(job);
}
