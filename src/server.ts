import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import rolesRoutes from "./routes/roles.js";
import tasksRoutes from "./routes/tasks.js";
import contactsRoutes from "./routes/contacts.js";
import autoMergeRoutes from "./routes/autoMerge.js";
import emailIssuesRoutes from "./routes/emailIssues.js";
import minutesRoutes from "./routes/minutes.js";
import consentsRoutes from "./routes/consents.js";
import schedulerRoutes from "./routes/scheduler.js";
import dashboardRoutes from "./routes/dashboard.js";
import applicationsRoutes from "./routes/applications.js";
import { SESSION_SECRET } from "./config.js";
import { registerJobs } from "./scheduler/index.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { loadUsers } from "./userStore.js";
import { getScmClient } from "./scraper/client.js";
import { prefetchForUser } from "./scraper/prefetch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
}));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(authRoutes);
app.use(requireAuth);
app.use(rolesRoutes);
app.use(tasksRoutes);
app.use(contactsRoutes);
app.use(autoMergeRoutes);
app.use(emailIssuesRoutes);
app.use(minutesRoutes);
app.use(consentsRoutes);
app.use(schedulerRoutes);
app.use(dashboardRoutes);
app.use(applicationsRoutes);

app.listen(PORT, () => {
  console.log(`scm-tools dashboard running at http://localhost:${PORT}`);
  registerJobs();
  for (const user of loadUsers()) {
    getScmClient(user.email).tryAutoConnect()
      .then(connected => { if (connected) return prefetchForUser(user.email); })
      .catch(() => {});
  }
});
