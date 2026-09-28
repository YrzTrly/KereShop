import { NextResponse } from 'next/server';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureUploadDir } from '@/lib/uploads.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — must match the cap in ImageUpload.js

// Images are stored on the local disk (data/uploads by default, /tmp
// fallback on serverless) and served back through /api/files/[name] — no
// external service required. Directory resolution lives in lib/uploads.js
// so the upload and serve routes always agree.

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
};

/**
 * POST /api/upload — upload an image (multipart, field name "file") and
 * return { url } pointing at /api/files/<name>. Files are saved to disk in
 * data/uploads/ (see .gitignore) so nothing leaves the server.
 */
export async function POST(req) {
  let file;
  try {
    const form = await req.formData();
    file = form.get('file');
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A "file" field is required' }, { status: 400 });
  }
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: 'Unsupported image type — use PNG, JPG, WebP, GIF or AVIF.' },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'Image must be 5 MB or smaller' }, { status: 400 });
  }

  try {
    const uploadDir = await ensureUploadDir();
    const name = `${randomBytes(16).toString('hex')}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, name), buffer);
    return NextResponse.json({ url: `/api/files/${name}` });
  } catch (err) {
    console.error('Upload failed:', err.message);
    return NextResponse.json(
      { error: `Upload failed: ${err.message || 'unknown error'}` },
      { status: 502 }
    );
  }
}

export async function GET() {
  const dir = await ensureUploadDir().catch(() => null);
  return NextResponse.json({ ok: true, dir, files: 0 });
}