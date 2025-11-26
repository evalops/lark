import screenshot from 'screenshot-desktop';
import { nativeImage, NativeImage } from 'electron';

interface ResizeOptions {
  width?: number;
  height?: number;
}

function resizeToFit(img: NativeImage, maxW?: number, maxH?: number): NativeImage {
  if (!maxW && !maxH) return img;
  const size = img.getSize();
  let w = size.width;
  let h = size.height;
  if (maxW && w > maxW) {
    h = Math.round(h * (maxW / w));
    w = maxW;
  }
  if (maxH && h > maxH) {
    w = Math.round(w * (maxH / h));
    h = maxH;
  }
  if (w === size.width && h === size.height) return img;
  return img.resize({ width: w, height: h });
}

export async function capturePngBuffer(resize?: ResizeOptions): Promise<Buffer> {
  const buf = await screenshot();
  let img = nativeImage.createFromBuffer(buf);
  if (resize && (resize.width || resize.height)) {
    img = resizeToFit(img, resize.width, resize.height);
  }
  return img.toPNG();
}

export async function captureBase64(
  resize: ResizeOptions = { width: 1280, height: 720 }
): Promise<string> {
  const buf = await screenshot();
  let img = nativeImage.createFromBuffer(buf);
  if (resize && (resize.width || resize.height)) {
    img = resizeToFit(img, resize.width, resize.height);
  }
  return img.toJPEG(80).toString('base64');
}

export async function captureToFile(
  path: string,
  resize?: ResizeOptions
): Promise<string> {
  const png = await capturePngBuffer(resize);
  const fs = await import('fs/promises');
  await fs.writeFile(path, png);
  return path;
}

export async function captureRegionBase64(region: number[]): Promise<string> {
  const [x1, y1, x2, y2] = region;
  const buf = await screenshot();
  const img = nativeImage.createFromBuffer(buf);
  const cropped = img.crop({
    x: Math.max(0, Math.floor(x1)),
    y: Math.max(0, Math.floor(y1)),
    width: Math.max(1, Math.floor(x2 - x1)),
    height: Math.max(1, Math.floor(y2 - y1)),
  });
  return cropped.toJPEG(80).toString('base64');
}
