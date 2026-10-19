/**
 * Image utilities — resize/compress user-uploaded images (signature, payment QR)
 * into data URLs small enough to live comfortably in IndexedDB.
 */

const MAX_SIGNATURE_BYTES = 120 * 1024; // 120 KB
const MAX_QR_BYTES = 250 * 1024; // 250 KB (QR must stay sharp)

/** Known image extensions — some Android file pickers report an empty MIME type. */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|svg|heic|heif)$/i;

/** Approximate decoded byte size of a data URL (base64 length × 3/4). */
function approxBytes(dataUrl: string): number {
  const payloadStart = dataUrl.indexOf(',') + 1;
  return Math.floor(((dataUrl.length - payloadStart) * 3) / 4);
}

/**
 * Reads a File, scales it down so its longest edge is `maxEdge` px,
 * and returns a JPEG/PNG data URL under the given size budget.
 * PNG is kept for images with transparency (signatures); otherwise JPEG.
 */
export async function fileToResizedDataUrl(
  file: File,
  maxEdge = 600,
  maxBytes = MAX_QR_BYTES
): Promise<string> {
  // Accept by extension too — some pickers give type '' for perfectly fine images.
  const looksLikeImage =
    file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name) || file.type === '';
  if (!looksLikeImage) {
    throw new Error('Please choose an image file');
  }

  const dataUrl = await readAsDataUrl(file);

  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    const isHeic = /hei[cf]$/i.test(file.name) || /image\/hei[cf]/.test(file.type);
    if (isHeic) {
      // HEIC renders in Safari only — Chrome/Android/WebView would show a
      // blank box on the slot AND on the printed bill. Fail with advice
      // instead of silently storing an invisible image.
      throw new Error(
        'This image format cannot be processed. Please use a JPG or PNG file (a screenshot works too).'
      );
    }
    // Undecodable here but valid elsewhere (rare) — keep the ORIGINAL bytes
    // when small enough, they may still render after sync on other devices.
    if (approxBytes(dataUrl) <= maxBytes * 2) return dataUrl;
    throw new Error(
      'This image format cannot be processed. Please use a JPG or PNG file (a screenshot works too).'
    );
  }

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, width, height);

  const keepPng = file.type === 'image/png';
  let out = canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.85);

  // Progressive JPEG downscale if still too heavy (budget compares BYTES,
  // not the base64 string length — base64 inflates size by ~33%).
  let quality = 0.85;
  let currentWidth = width;
  while (approxBytes(out) > maxBytes && quality > 0.35) {
    quality -= 0.15;
    out = canvas.toDataURL('image/jpeg', quality);
    if (approxBytes(out) > maxBytes && currentWidth > 200) {
      currentWidth = Math.round(currentWidth * 0.75);
      const tmp = document.createElement('canvas');
      tmp.width = currentWidth;
      tmp.height = Math.round((height * currentWidth) / width);
      tmp.getContext('2d')?.drawImage(canvas, 0, 0, tmp.width, tmp.height);
      canvas.width = tmp.width;
      canvas.height = tmp.height;
      canvas.getContext('2d')?.drawImage(tmp, 0, 0);
    }
  }

  return out;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Invalid image file'));
    img.src = src;
  });
}
