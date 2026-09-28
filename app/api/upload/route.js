import { NextResponse } from 'next/server';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — must match the cap in ImageUpload.js

// Images are stored on the local disk under data/uploads (gitignored) and
// served back through /api/files/[name] — no external service required.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), 'data', 'uploads');

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
    await mkdir(UPLOAD_DIR, { recursive: true });
    const name = `${randomBytes(16).toString('hex')}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(UPLOAD_DIR, name), buffer);
    return NextResponse.json({ url: `/api/files/${name}` });
  } catch (err) {
    if (err && err.code === 'EROFS') {
      return NextResponse.json(
        {
          error:
            'Uploads are stored on the server disk, which is read-only on this platform. Run the app locally or on a VPS to enable image uploads.',
        },
        { status: 507 }
      );
    }
    console.error('Upload failed:', err.message);
    return NextResponse.json(
      { error: `Upload failed: ${err.message || 'unknown error'}` },
      { status: 502 }
    );
  }
}

export async function GET() {
  const res = await stat(UPLOAD_DIR).catch(() => null);
  const count = res && res.isDirectory() ? 0 : 0;
  return NextResponse.json({ ok: true, dir: UPLOAD_DIR, files: count });
}