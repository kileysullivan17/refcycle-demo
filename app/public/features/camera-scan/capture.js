// Getting a photo ready for POST /api/identify (contracts 4): JPEG, PNG or WebP, at most 5 MB decoded.
// The photo lives in memory only. It is never put in browser storage and never kept after the call (CS-10).

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_SIDE = 2000; // used only when a photo has to be re-encoded to fit

/** Decoded size, in bytes, of a base64 data URL. */
export function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** A photo that is already an accepted type and small enough is sent exactly as it is. */
export function canSendAsIs(file) {
  return !!file && ACCEPTED_TYPES.includes(file.type) && file.size > 0 && file.size <= MAX_BYTES;
}

/** Fits a width and height inside max by max, keeping the shape. Never enlarges. */
export function scaleSize(width, height, max = MAX_SIDE) {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width: 0, height: 0 };
  const ratio = Math.min(1, max / longest);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The photo could not be read'));
    reader.readAsDataURL(blob);
  });
}

function drawToJpeg(source, width, height) {
  const size = scaleSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d').drawImage(source, 0, 0, size.width, size.height);
  for (const quality of [0.9, 0.8, 0.65, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(url) <= MAX_BYTES) return url;
  }
  throw new Error('The photo is too large');
}

/** A chosen file as a data URL the server accepts. Re-encodes only when the file would be refused. */
export async function fileToDataUrl(file) {
  if (canSendAsIs(file)) return readAsDataUrl(file);
  if (!file || !String(file.type).startsWith('image/')) throw new Error('Choose a JPEG, PNG or WebP photo');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo type cannot be read here. Choose a JPEG, PNG or WebP photo');
  }
  try {
    return drawToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

/** The current viewfinder frame as a JPEG data URL. */
export function frameToDataUrl(video) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The camera is not ready yet');
  return drawToJpeg(video, video.videoWidth, video.videoHeight);
}
