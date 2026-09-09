// Pixels in and out, in the one place, so a node never repeats the dance.
//
// An image port carries a path, not pixels (see `cascade/io`), so every node
// that wants numbers has to decode a file and every node that produces numbers
// has to encode one. Both hosts supply `OffscreenCanvas` — the browser natively,
// the headless host through @napi-rs/canvas — so one implementation covers both.

import { loadBitmap, saveImage, type ImageRef } from 'cascade/io';

export interface Raster {
  /** RGBA, 8 bits a channel, row-major from the top left */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

function canvas2d(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D context on this host');
  return { canvas, ctx };
}

/** Decode an image port's file into 8-bit RGBA. Exact for opaque PNG. */
export async function readRaster(ref: { path: string }): Promise<Raster> {
  const bitmap = await loadBitmap(ref.path, { raw: true });
  const { ctx } = canvas2d(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data: image.data as Uint8ClampedArray<ArrayBuffer>, width: bitmap.width, height: bitmap.height };
}

/** Write 8-bit RGBA out as a PNG and return the port value for it. */
export async function writeRaster(raster: Raster, path: string): Promise<ImageRef> {
  const { canvas, ctx } = canvas2d(raster.width, raster.height);
  ctx.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
  const stored = await saveImage(canvas, path);
  return {
    path: stored,
    size: [raster.width, raster.height],
    channels: 'rgba',
    depth: 'u8',
    space: 'srgb',
  };
}

/** A blank opaque raster, ready to be written into. */
export function blankRaster(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width, height };
}
