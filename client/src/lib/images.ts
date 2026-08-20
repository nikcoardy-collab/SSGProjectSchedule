import { MAX_FILE_BYTES } from './api';

/** Longest edge a photo keeps after resizing — plenty for screens and reports. */
const MAX_DIMENSION = 1920;

/** Leave headroom under the request cap so an encode never lands exactly on it. */
const TARGET_BYTES = MAX_FILE_BYTES - 64 * 1024;

/** Formats the canvas can decode and re-encode without losing anything that matters. */
const RESIZABLE = /^image\/(jpeg|png|webp|bmp)$/i;

function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

async function encode(
  bitmap: ImageBitmap,
  maxDim: number,
  quality: number
): Promise<Blob | null> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // JPEG has no transparency — flatten onto white so PNGs don't turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Shrinks a photo until it fits the upload cap: scaled to at most 1920px on its
 * longest edge and re-encoded as JPEG, stepping quality and size down as needed.
 * Anything that isn't a resizable image — documents, GIFs, formats the browser
 * can't decode — comes back untouched.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!RESIZABLE.test(file.type)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // undecodable — let the size check upstream deal with it
  }

  try {
    const oversized = file.size > TARGET_BYTES;
    const tooLarge = Math.max(bitmap.width, bitmap.height) > MAX_DIMENSION;
    if (!oversized && !tooLarge) return file;

    for (const maxDim of [MAX_DIMENSION, 1440, 1080, 800]) {
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await encode(bitmap, maxDim, quality);
        if (blob && blob.size <= TARGET_BYTES) {
          return new File([blob], jpegName(file.name), { type: 'image/jpeg' });
        }
      }
    }
    return file; // give up — the caller's size check reports it
  } finally {
    bitmap.close();
  }
}
