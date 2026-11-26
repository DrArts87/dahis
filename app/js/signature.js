// Handtekening van de voorschrijver (0.5.2, plan D2 en docs/plans/2026-11-26-d2-voorschrijver.md).
//
// Eén record van kind 'signature' in de versleutelde kluis, met inhoud
// {schema: 1, data: {type: 'image/png', width, height, png: base64}}. Verplicht
// in de vaste stap. Tekenen en een gekozen afbeelding gaan beide naar één
// formaat: zwart op transparant, bijgesneden tot de inkt, hooguit
// MAX_WIDTH × MAX_HEIGHT pixels, PNG. Alleen dat nieuwe plaatje wordt bewaard,
// nooit het originele bestand.
//
// Tonen gebeurt op een <canvas> via createImageBitmap, zodat de CSP
// (img-src 'self') niet ruimer hoeft. Alleen verzonnen voorbeelden in tests.

export const SIGNATURE_KIND = 'signature';
export const SIGNATURE_SCHEMA = 1;
export const SIGNATURE_TYPE = 'image/png';
export const MAX_WIDTH = 600;
export const MAX_HEIGHT = 240;
export const MAX_PNG_BYTES = 200 * 1024;          // het opgeslagen plaatje
export const MAX_FILE_BYTES = 10 * 1024 * 1024;   // een gekozen afbeelding
export const MAX_SOURCE_SIDE = 1600;              // groter wordt eerst verkleind
// Bijna wit wordt transparant (achtergrond van een foto op papier).
export const WHITE_LEVEL = 200;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class SignatureError extends Error {
  constructor(code) {
    super('Handtekening: ' + code);
    this.name = 'SignatureError';
    this.code = code;   // empty | file | type | size | image
  }
}

// --- base64 (zonder geheugenpiek bij een paar honderd kB) ----------------------------

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// --- Inhoud strikt controleren ---------------------------------------------------------

function isPng(bytes) {
  return bytes.length > PNG_MAGIC.length && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

// Breedte en hoogte uit de IHDR van een PNG (bytes 16–23).
function pngSize(bytes) {
  if (bytes.length < 24) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

// true als `data` een geldige handtekening is (zoals opgeslagen).
export function isValidSignature(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data).sort().join(',');
  if (keys !== 'height,png,type,width') return false;
  if (data.type !== SIGNATURE_TYPE) return false;
  if (!Number.isInteger(data.width) || data.width < 1 || data.width > MAX_WIDTH) return false;
  if (!Number.isInteger(data.height) || data.height < 1 || data.height > MAX_HEIGHT) return false;
  if (typeof data.png !== 'string' || data.png.length > Math.ceil(MAX_PNG_BYTES / 3) * 4) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.png)) return false;
  let bytes;
  try { bytes = base64ToBytes(data.png); } catch (err) { return false; }
  if (bytes.length > MAX_PNG_BYTES || !isPng(bytes)) return false;
  const size = pngSize(bytes);
  return Boolean(size) && size.width === data.width && size.height === data.height;
}

export function readSignature(data) {
  return isValidSignature(data) ? { type: data.type, width: data.width, height: data.height, png: data.png } : null;
}

// --- Pixels opschonen (zonder DOM, te testen in Node) --------------------------------

// Op een ImageData-achtig object {width, height, data: RGBA}: bijna wit en
// transparant wordt helemaal transparant, de rest zwart met een dekking naar
// hoe donker het was. Geeft het kader van de inkt terug, of null als er geen
// inkt is.
export function cleanPixels(img, whiteLevel = WHITE_LEVEL) {
  const { width, height, data } = img;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Op wit gezette dekking: een halfdoorzichtige pixel telt als lichter.
      const onWhite = 255 - (255 - lum) * a;
      if (onWhite >= whiteLevel) {
        data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 0;
        continue;
      }
      const ink = Math.round(255 * (whiteLevel - onWhite) / whiteLevel);
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = Math.min(255, Math.max(48, ink * 2));
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Doelmaat binnen MAX_WIDTH × MAX_HEIGHT met dezelfde verhouding, met een
// kleine rand.
export function fitSize(width, height, maxW = MAX_WIDTH, maxH = MAX_HEIGHT) {
  const pad = 8;
  const scale = Math.min(1, (maxW - 2 * pad) / width, (maxH - 2 * pad) / height);
  return {
    width: Math.max(1, Math.round(width * scale) + 2 * pad),
    height: Math.max(1, Math.round(height * scale) + 2 * pad),
    scale, pad,
  };
}

// --- In de browser: van tekening of afbeelding naar een handtekening --------------------

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

async function canvasToPng(canvas) {
  const blob = typeof canvas.convertToBlob === 'function'
    ? await canvas.convertToBlob({ type: SIGNATURE_TYPE })
    : await new Promise((resolve) => canvas.toBlob(resolve, SIGNATURE_TYPE));
  if (!blob) throw new SignatureError('image');
  return new Uint8Array(await blob.arrayBuffer());
}

// Van een bron (canvas met een tekening, of een ImageBitmap van een bestand)
// naar {type, width, height, png}.
export async function fromSource(source, srcWidth, srcHeight) {
  if (!srcWidth || !srcHeight) throw new SignatureError('empty');
  const shrink = Math.min(1, MAX_SOURCE_SIDE / Math.max(srcWidth, srcHeight));
  const w = Math.max(1, Math.round(srcWidth * shrink));
  const h = Math.max(1, Math.round(srcHeight * shrink));
  const work = makeCanvas(w, h);
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(source, 0, 0, w, h);
  const img = wctx.getImageData(0, 0, w, h);
  const box = cleanPixels(img);
  if (!box) throw new SignatureError('empty');
  wctx.putImageData(img, 0, 0);
  const size = fitSize(box.width, box.height);
  const out = makeCanvas(size.width, size.height);
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(work, box.x, box.y, box.width, box.height,
    size.pad, size.pad, size.width - 2 * size.pad, size.height - 2 * size.pad);
  const png = await canvasToPng(out);
  if (png.length > MAX_PNG_BYTES) throw new SignatureError('size');
  const data = { type: SIGNATURE_TYPE, width: size.width, height: size.height, png: bytesToBase64(png) };
  if (!isValidSignature(data)) throw new SignatureError('image');
  return data;
}

// Een gekozen bestand (File): alleen afbeeldingen, met een grens aan de grootte.
export async function fromFile(file) {
  if (!file || typeof file.size !== 'number') throw new SignatureError('file');
  if (file.size > MAX_FILE_BYTES) throw new SignatureError('size');
  if (typeof file.type !== 'string' || !file.type.startsWith('image/')) throw new SignatureError('type');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new SignatureError('image');
  }
  try {
    return await fromSource(bitmap, bitmap.width, bitmap.height);
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

// Tekent een opgeslagen handtekening passend en gecentreerd op een canvas.
export async function drawSignature(canvas, data) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!isValidSignature(data)) return false;
  const bitmap = await createImageBitmap(new Blob([base64ToBytes(data.png)], { type: SIGNATURE_TYPE }));
  try {
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height, 2);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
  return true;
}
