import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function cloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * POST /api/upload — upload an image file (multipart, field name "file") to
 * Cloudinary and return { url: secure_url }. Credentials are read from
 * environment variables and never sent to the client.
 */
export async function POST(req) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return NextResponse.json(
      {
        error:
          'Image upload is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
      },
      { status: 503 }
    );
  }

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
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'Image must be 5 MB or smaller' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await new Promise((resolve, reject) => {
      // The Cloudinary SDK only auto-reads CLOUDINARY_URL, not the individual
      // CLOUDINARY_* variables, so pass the config explicitly from env.
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'image', folder: 'kereshop/products' },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(buffer);
    });
    return NextResponse.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary upload failed:', err.message);
    return NextResponse.json(
      { error: `Upload failed: ${err.message || 'unknown error'}. Check the CLOUDINARY_* env vars and try again.` },
      { status: 502 }
    );
  }
}