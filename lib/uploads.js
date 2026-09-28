import { mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Resolve the directory uploaded images are stored in. Serverless platforms
// (e.g. Vercel) expose a read-only working directory (e.g. /var/task) but a
// writable /tmp, so we fall back there instead of failing with
// EROFS/ENOENT. Note: on serverless /tmp is ephemeral per function instance,
// so uploads may 404 after the instance is recycled — for durable storage
// point UPLOAD_DIR at a real volume (VPS) or an object store.
const PRIMARY_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), 'data', 'uploads');
const TMP_DIR = path.join(os.tmpdir(), 'kereshop-uploads');

/** All directories that may contain uploads (primary first, then temp). */
export function uploadCandidateDirs() {
  return [...new Set([PRIMARY_DIR, TMP_DIR])];
}

/**
 * Create the upload directory if needed and return its absolute path.
 * Tries the configured/primary location first, then the OS temp dir.
 * @returns {Promise<string>} absolute path of a writable uploads directory
 */
export async function ensureUploadDir() {
  const dirs = [...new Set([PRIMARY_DIR, TMP_DIR])];
  const errors = [];
  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true });
      const st = await stat(dir);
      if (st.isDirectory()) return dir;
      errors.push(`${dir}: not a directory`);
    } catch (e) {
      errors.push(`${dir}: ${e.code || e.message}`);
    }
  }
  throw new Error(`No writable uploads directory (${errors.join(' | ')})`);
}