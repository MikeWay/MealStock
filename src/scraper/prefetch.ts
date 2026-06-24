import { getScmClient } from "./client.js";
import { fetchAttentionItems } from "./tasks.js";
import { fetchEmailIssues } from "./emailIssues.js";

interface PrefetchData {
  tasks: number | null;
  emailIssues: number | null;
  fetchedAt: string | null;
}

const store = new Map<string, PrefetchData>();

export function getPrefetchData(userEmail: string): PrefetchData {
  return store.get(userEmail) ?? { tasks: null, emailIssues: null, fetchedAt: null };
}

export async function prefetchForUser(userEmail: string): Promise<void> {
  const client = getScmClient(userEmail);
  if (!client.loggedIn) return;

  const [tasksPage, emailPage] = await Promise.all([
    client.getPage(),
    client.getPage(),
  ]);

  const [tasksResult, emailResult] = await Promise.allSettled([
    fetchAttentionItems(tasksPage).then((items) => items.length),
    fetchEmailIssues(emailPage).then((issues) => issues.length),
  ]);

  await Promise.allSettled([tasksPage.close(), emailPage.close()]);

  store.set(userEmail, {
    tasks: tasksResult.status === "fulfilled" ? tasksResult.value : null,
    emailIssues: emailResult.status === "fulfilled" ? emailResult.value : null,
    fetchedAt: new Date().toISOString(),
  });

  console.log(
    `[prefetch] ${userEmail}: tasks=${tasksResult.status === "fulfilled" ? tasksResult.value : "failed"}, emailIssues=${emailResult.status === "fulfilled" ? emailResult.value : "failed"}`
  );
}
