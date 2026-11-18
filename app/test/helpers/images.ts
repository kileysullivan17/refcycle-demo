// Tiny images for tests. The PNG is a real 1 by 1 picture; the others carry a valid signature only.
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
export const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
export const JPEG_DATA_URL = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(16, 1)]);
export const WEBP_DATA_URL = `data:image/webp;base64,${webp.toString('base64')}`;

/** A JPEG-signed payload of the given decoded size. */
export function jpegOfSize(bytes: number): string {
  const buf = Buffer.alloc(bytes, 7);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
