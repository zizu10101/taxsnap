// Server-side look at an uploaded photo's bytes. The client re-encodes through a canvas (which writes no
// EXIF), so the server only has to confirm it really got a JPEG and that no metadata segment came along
// - location data in particular lives in the EXIF (APP1) segment. Import-free for node tests.

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// Walks the JPEG's marker segments up to the start of image data and reports whether any carry
// metadata we don't want stored: APP1 (EXIF / XMP), APP13 (Photoshop / IPTC), COM comments.
// APP0 (JFIF) and the other structural segments are fine.
export function hasMetadataSegment(bytes: Uint8Array): boolean {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return false;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return false; // start of scan / end: no more headers
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return true;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // standalone markers carry no length
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return false;
    i += 2 + length;
  }
  return false;
}
