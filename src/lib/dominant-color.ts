/**
 * Client-only helpers for sampling a logo's dominant colour in the admin panel.
 * They use the DOM (`Image`, `<canvas>`), so they must never run on the server.
 */

/**
 * Load an image so its pixels can be read onto a canvas. Remote http(s) URLs go
 * through our same-origin proxy — reading an arbitrary host's image directly
 * taints the canvas and blocks the pixel read — while app-relative URLs (an
 * uploaded logo under `/api/uploads/...`) load straight from our own origin.
 */
function loadSampleableImage(url: string): Promise<HTMLImageElement> {
  const src = /^https?:\/\//i.test(url)
    ? `/api/admin/image-proxy?url=${encodeURIComponent(url)}`
    : url;

  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = src;
  });
}

/**
 * The dominant colour of a logo as `#rrggbb`, or null if it can't be sampled.
 *
 * The image is drawn small and its pixels bucketed into a coarse colour grid.
 * Fully transparent pixels are ignored, and each pixel is weighted towards
 * vivid, mid-tone colours — so a logo's brand colour wins over the white or
 * transparent backdrop it usually sits on. If nothing vivid is found (a
 * greyscale mark), the most common opaque colour is used instead.
 */
export async function dominantColorFromUrl(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let img: HTMLImageElement;
  try {
    img = await loadSampleableImage(trimmed);
  } catch {
    return null;
  }

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // Canvas was tainted despite the proxy — give up rather than throw.
    return null;
  }

  type Bucket = { count: number; score: number; r: number; g: number; b: number };
  const buckets = new Map<string, Bucket>();

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a < 128) continue; // ignore transparent backdrop

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lightness = max / 255;
    // Favour saturated, mid-tone pixels; near-white/black/grey contribute little.
    const weight = saturation * (1 - Math.abs(lightness - 0.5));

    const key = `${r >> 4},${g >> 4},${b >> 4}`; // 16 levels per channel
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, score: 0, r: 0, g: 0, b: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.score += weight;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
  }

  if (buckets.size === 0) return null;

  let vivid: Bucket | null = null;
  let common: Bucket | null = null;
  for (const bucket of buckets.values()) {
    if (!vivid || bucket.score > vivid.score) vivid = bucket;
    if (!common || bucket.count > common.count) common = bucket;
  }

  // Use the vivid winner when there's real colour to speak of; otherwise fall
  // back to the most common opaque colour (a greyscale or monochrome logo).
  const chosen = vivid && vivid.score > 0.5 ? vivid : common;
  if (!chosen) return null;

  const r = Math.round(chosen.r / chosen.count);
  const g = Math.round(chosen.g / chosen.count);
  const b = Math.round(chosen.b / chosen.count);
  const toHex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
