/**
 * Squaring and shrinking a photo before it is uploaded.
 *
 * There is no image library on the API and this is not worth adding one for:
 * `sharp` is a native binary in the deployment image to resize a file the
 * browser is already holding decoded. A 4 MB phone photo leaves here as a
 * ~40 KB WebP.
 *
 * **`imageOrientation: 'from-image'` is the line that matters.** Phones record
 * portrait shots as landscape plus an EXIF rotation flag. Drawing to a canvas
 * discards that flag, so without this every photo taken in portrait would be
 * stored on its side — and it would be stored that way permanently, because
 * the rotation is lost at the moment of the draw.
 */

/** Big enough for the largest avatar on any screen (64px) on a 3× display, and then some. */
const MAX_EDGE = 512;

const OUTPUT_TYPE = 'image/webp';
const QUALITY = 0.85;

export interface PreparedImage {
  blob: Blob;
  filename: string;
}

/**
 * Centre-crops to a square and scales down. Returns the original untouched if
 * the browser cannot do any of it — the server validates and caps regardless,
 * so the worst case is a larger upload, not a broken one.
 */
export async function prepareAvatar(file: File): Promise<PreparedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      // Square from the middle: a face is nearly always centred, and cropping
      // to the shorter edge is what the round frame will show anyway.
      const edge = Math.min(bitmap.width, bitmap.height);
      const sx = (bitmap.width - edge) / 2;
      const sy = (bitmap.height - edge) / 2;
      const size = Math.min(edge, MAX_EDGE);

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { blob: file, filename: file.name };
      ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, size, size);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, OUTPUT_TYPE, QUALITY),
      );
      // A browser without WebP encoding returns null rather than throwing.
      if (!blob) return { blob: file, filename: file.name };
      return { blob, filename: 'avatar.webp' };
    } finally {
      bitmap.close();
    }
  } catch {
    return { blob: file, filename: file.name };
  }
}
