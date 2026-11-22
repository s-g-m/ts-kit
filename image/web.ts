import { newError } from "../base/errs/errs.ts";
import {
  CodeImageUnreadable,
  DEFAULT_IMAGE_LIMITS,
  fitWithin,
  type ImageLimits,
  PREPARED_IMAGE_MIME,
  type PreparedImage,
} from "./image.ts";

/**
 * Reduces a file chosen in the browser to a JPEG of at most limits.maxSide and its thumbnail, drawing it on a canvas.
 * Re-encoding also drops the metadata of the original file (location, camera).
 */
export async function prepareImage(
  file: Blob,
  limits: ImageLimits = DEFAULT_IMAGE_LIMITS,
): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    const failure = newError(CodeImageUnreadable, "the file is not a readable image").badRequest();
    failure.wrap(err);
    throw failure;
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, limits.maxSide);
    const thumbSize = fitWithin(bitmap.width, bitmap.height, limits.thumbSide);
    const [image, thumb] = await Promise.all([
      encode(bitmap, size, limits.quality),
      encode(bitmap, thumbSize, limits.quality),
    ]);
    return { image, thumb, mime: PREPARED_IMAGE_MIME, ...size };
  } finally {
    bitmap.close();
  }
}

function encode(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.reject(newError(CodeImageUnreadable, "canvas is not available"));
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(newError(CodeImageUnreadable, "the image could not be encoded")),
      PREPARED_IMAGE_MIME,
      quality,
    );
  });
}
