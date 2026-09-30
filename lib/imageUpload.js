import multer from 'multer';
import { Readable } from 'node:stream';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

// Memory storage only — files are held as Buffers, never written to disk.
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 20,
  },
  fileFilter: (req, file, callback) => {
    if (IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error(`Only image files are allowed (got ${file.mimetype})`));
    }
  },
});

export class ImageUploadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ImageUploadError';
    if (cause) this.cause = cause;
  }
}

export function isMultipart(request) {
  return (request.headers.get('content-type') || '')
    .toLowerCase()
    .startsWith('multipart/form-data');
}

/**
 * Parse a multipart/form-data Web `Request` with Multer using memory storage,
 * so the image flows Browser -> Multer buffer -> Cloudinary without ever
 * landing on the local filesystem. Text form fields are returned alongside.
 *
 * The route handler passes the raw request body straight to Multer; `upload.any`
 * collects text fields into `fields` and file parts into `files`.
 *
 * @param {Request} request incoming Next.js App Router route-handler request
 * @param {object} [options]
 * @param {string} [options.imageField='image'] multipart file field name to expose as `image`
 * @returns {Promise<{ fields: Record<string, string>, image: { buffer: Buffer, filename: string, mimetype: string } | null }>}
 *   `image` is null when the form had no file part for `imageField`
 * @throws {ImageUploadError} on non-multipart bodies, empty bodies, oversized files, or non-image files
 */
export async function parseMultipartForm(request, options = {}) {
  const { imageField = 'image' } = options;

  if (!request.body) {
    throw new ImageUploadError('Request has no body');
  }
  if (!isMultipart(request)) {
    throw new ImageUploadError('Expected a multipart/form-data request');
  }

  // Buffer the body once so Multer (a Node-stream parser) can consume it,
  // independent of how the Web Request body stream behaves.
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length === 0) {
    throw new ImageUploadError('Empty request body');
  }

  const headers = Object.fromEntries(request.headers.entries());

  // type-is (used by Multer) only treats the request as having a body when
  // content-length or transfer-encoding is present, so always set one.
  if (headers['content-length'] === undefined && headers['transfer-encoding'] === undefined) {
    headers['content-length'] = String(raw.length);
  }

  const nodeReq = Object.assign(Readable.from(raw), {
    headers,
    method: request.method || 'POST',
  });

  const parsed = await new Promise((resolve, reject) => {
    upload.any()(nodeReq, {}, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return reject(
            new ImageUploadError(
              `Image too large — maximum size is ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
              err
            )
          );
        }
        return reject(new ImageUploadError(err.message, err));
      }
      resolve({ fields: nodeReq.body || {}, files: nodeReq.files || [] });
    });
  });

  const imageFile =
    parsed.files.find((f) => f.fieldname === imageField) || parsed.files[0] || null;

  const files = parsed.files.map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    filename: f.originalname,
    mimetype: f.mimetype,
  }));

  return {
    fields: parsed.fields,
    files,
    image: imageFile
      ? { buffer: imageFile.buffer, filename: imageFile.originalname, mimetype: imageFile.mimetype }
      : null,
  };
}