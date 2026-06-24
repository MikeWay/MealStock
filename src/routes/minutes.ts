import { Router } from "express";
import { NodeSSH } from "node-ssh";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import multer from "multer";
import { getScmClient } from "../scraper/client.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  regenerateMinutesPage,
  parseDateFromFilename,
  linkTextFromFilename,
  type MinutesSection,
} from "../scraper/minutes.js";
import {
  SSH_HOST,
  SSH_USER,
  SSH_KEY_PATH,
  MINUTES_REMOTE_PATH,
  MINUTES_PUBLIC_URL_BASE,
  MINUTES_SCM_PAGE_URL,
} from "../config.js";

const router = Router();
router.use(requirePermission("minutes", "full"));
const upload = multer({ storage: multer.memoryStorage() });

router.post("/api/minutes/sync", upload.array("files"), async (req, res) => {
  try {
    if (!getScmClient(req.session.userEmail!).loggedIn) {
      res.status(401).json({ success: false, message: "Not logged in to SCM" });
      return;
    }

    const uploadedFiles = req.files as Express.Multer.File[] | undefined;
    if (!uploadedFiles || uploadedFiles.length === 0) {
      res.status(400).json({ success: false, message: "No files uploaded" });
      return;
    }

    // Each file's originalname is encoded as "<subdir>__<filename>" by the client,
    // where subdir is the immediate parent folder (e.g. "management", "sailing").
    // We split only on the first "__" so filenames containing "__" are preserved.
    const subdirFiles = new Map<string, string[]>();
    for (const file of uploadedFiles) {
      const sep = file.originalname.indexOf("__");
      if (sep === -1) continue;
      const subdir = file.originalname.slice(0, sep);
      const filename = file.originalname.slice(sep + 2).replace(/ /g, "_");
      if (!subdir || !filename.toLowerCase().endsWith(".pdf")) continue;
      if (!subdirFiles.has(subdir)) subdirFiles.set(subdir, []);
      subdirFiles.get(subdir)!.push(filename);
    }

    if (subdirFiles.size === 0) {
      res.status(400).json({
        success: false,
        message: "No valid PDF files found (files must be inside a subdirectory)",
      });
      return;
    }

    // Create an isolated temp directory for this request
    const tmpDir = path.join(os.tmpdir(), `scm-minutes-${randomUUID()}`);
    try {
      // Write uploaded buffers to the temp dir in their subdir structure
      for (const file of uploadedFiles) {
        const sep = file.originalname.indexOf("__");
        if (sep === -1) continue;
        const subdir = file.originalname.slice(0, sep);
        const filename = file.originalname.slice(sep + 2).replace(/ /g, "_");
        if (!subdir || !filename.toLowerCase().endsWith(".pdf")) continue;
        const subdirPath = path.join(tmpDir, subdir);
        await fs.mkdir(subdirPath, { recursive: true });
        await fs.writeFile(path.join(subdirPath, filename), file.buffer);
      }

      // Collect PDF files per subdir, sorted by date
      type SectionFiles = { name: string; files: string[] };
      const sectionFiles: SectionFiles[] = [];
      for (const [subdir, files] of [...subdirFiles.entries()].sort()) {
        const pdfs = files.sort((a, b) => {
          const da = parseDateFromFilename(a);
          const db = parseDateFromFilename(b);
          return (da?.getTime() ?? 0) - (db?.getTime() ?? 0);
        });
        sectionFiles.push({ name: subdir, files: pdfs });
      }

      // SSH: upload all files
      const ssh = new NodeSSH();
      try {
        await ssh.connect({
          host: SSH_HOST,
          username: SSH_USER,
          privateKeyPath: SSH_KEY_PATH,
        });

        // Resolve ~ in the remote base path and ensure it exists
        const baseResult = await ssh.execCommand(
          `mkdir -p ${MINUTES_REMOTE_PATH} && echo ${MINUTES_REMOTE_PATH}`
        );
        if (baseResult.code !== 0) {
          throw new Error(`Cannot create remote base dir: ${baseResult.stderr}`);
        }
        const resolvedBase = baseResult.stdout.trim();

        for (const { name, files } of sectionFiles) {
          const remoteDir = `${resolvedBase}/${name}`;
          await ssh.execCommand(`mkdir -p ${remoteDir}`);
          for (const filename of files) {
            const localFilePath = path.join(tmpDir, name, filename);
            await ssh.putFile(localFilePath, `${remoteDir}/${filename}`);
          }
        }
      } catch (sshErr) {
        const message = sshErr instanceof Error ? sshErr.message : "SSH upload failed";
        res.status(502).json({ success: false, message: `SSH upload failed: ${message}` });
        return;
      } finally {
        ssh.dispose();
      }

      // Build sections for page regeneration
      const SECTION_DESCRIPTIONS: Record<string, string> = {
        management: "The Management Committee meets monthly (except August and December).",
        sailing: "The Sailing Committee meets at least 4 times per year.",
      };

      const sections: MinutesSection[] = sectionFiles.map(({ name, files }) => ({
        heading: name.charAt(0).toUpperCase() + name.slice(1),
        description: SECTION_DESCRIPTIONS[name.toLowerCase()],
        links: files.map((f) => ({
          text: linkTextFromFilename(f),
          url: `${MINUTES_PUBLIC_URL_BASE}/${name}/${f}`,
        })),
      }));

      // Regenerate SCM page
      const page = await getScmClient(req.session.userEmail!).getPage();
      try {
        await regenerateMinutesPage(page, MINUTES_SCM_PAGE_URL, sections);
      } catch (scmErr) {
        const message = scmErr instanceof Error ? scmErr.message : "SCM update failed";
        const uploaded = sectionFiles.reduce((n, s) => n + s.files.length, 0);
        res.status(207).json({
          success: false,
          filesUploaded: uploaded,
          message: `${uploaded} file(s) uploaded but SCM page update failed: ${message}`,
        });
        return;
      } finally {
        await page.close();
      }

      const total = sectionFiles.reduce((n, s) => n + s.files.length, 0);
      res.json({
        success: true,
        message: `Synced ${total} file(s) across ${sections.length} section(s) and regenerated SCM page.`,
        sections: sections.map((s) => ({ heading: s.heading, count: s.links.length })),
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, message });
  }
});

export default router;
