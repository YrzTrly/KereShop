import { v2 as cloudinary } from 'cloudinary';

const REQUIRED_ENV = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

let configuredFor = null;

function ensureConfigured() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new CloudinaryUploadError(
      `Cloudinary is not configured — set ${missing.join(', ')} in .env`
    );
  }
  const signature = REQUIRED_ENV.map((key) => process.env[key]).join(':');
  if (configuredFor !== signature) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    configuredFor = signature;
  }
}

export class CloudinaryUploadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CloudinaryUploadError';
    if (cause) this.cause = cause;
  }
}

/**
 * Upload an in-memory image buffer to Cloudinary.
 *
 * @param {Buffer | Uint8Array} buffer raw image bytes (e.g. from Multer memory storage)
 * @param {object} [options]
 * @param {string} [options.folder='kereshop/products'] destination folder
 * @param {string} [options.originalName] original file name (kept as metadata, Cloudinary generates a unique public id)
 * @returns {Promise<string>} the Cloudinary secure_url
 * @throws {CloudinaryUploadError} on missing config or upload failure
 */
export async function uploadBufferToCloudinary(buffer, options = {}) {
  const { folder = 'kereshop/products', originalName, mimeType } = options;

  if (!buffer || (!Buffer.isBuffer(buffer) && typeof buffer.byteLength !== 'number')) {
    throw new CloudinaryUploadError('uploadBufferToCloudinary requires an image buffer');
  }

  ensureConfigured();

  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // The Node SDK's uploader.upload() takes a file path or a data URI — a raw
  // Buffer throws ERR_INVALID_ARG_TYPE — so encode it as a base64 data URI.
  const type =
    mimeType && /^image\/[a-z0-9.+-]+$/i.test(String(mimeType))
      ? String(mimeType)
      : 'application/octet-stream';
  const dataUri = `data:${type};base64,${payload.toString('base64')}`;

  try {
    const result = await cloudinary.uploader
      .upload(dataUri, {
        resource_type: 'image',
        folder,
        use_filename: Boolean(originalName),
        unique_filename: true,
        ...(originalName ? { original_filename: originalName } : {}),
      })
      .catch((error) => {
        throw new CloudinaryUploadError(
          `Cloudinary upload failed: ${error?.message || error}`,
          error
        );
      });

    if (!result?.secure_url) {
      throw new CloudinaryUploadError('Cloudinary returned no secure_url');
    }
    return result.secure_url;
  } catch (error) {
    if (error instanceof CloudinaryUploadError) throw error;
    console.error('[cloudinary] upload error:', error);
    throw new CloudinaryUploadError('Cloudinary upload failed unexpectedly', error);
  }
}