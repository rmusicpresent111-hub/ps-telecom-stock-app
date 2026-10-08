/**
 * Image utilities — resize/compress user-uploaded images (signature, payment QR)
 * into data URLs small enough to live comfortably in IndexedDB.
 */

const MAX_SIGNATURE_BYTES = 120 * 1024; // 120 KB
const MAX_QR_BYTES = 250 * 1024; // 250 KB (QR must stay sharp)

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
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file');
  }

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

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

  // Progressive JPEG downscale if still too heavy
  let quality = 0.85;
  let currentWidth = width;
  while (out.length > maxBytes && quality > 0.35) {
    quality -= 0.15;
    out = canvas.toDataURL('image/jpeg', quality);
    if (out.length > maxBytes && currentWidth > 200) {
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
