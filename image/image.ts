/** Image reduced on the device before uploading it: the image and its square-bounded thumbnail. */
export interface PreparedImage {
  image: Blob;
  thumb: Blob;
  mime: "image/jpeg";
  width: number;
  height: number;
}

/** Bounds of the reduced image and of its thumbnail, in pixels of the longest side. */
export interface ImageLimits {
  maxSide: number;
  thumbSide: number;
  /** JPEG quality between 0 and 1. */
  quality: number;
}

export const DEFAULT_IMAGE_LIMITS: ImageLimits = { maxSide: 1024, thumbSide: 256, quality: 0.82 };

export const PREPARED_IMAGE_MIME = "image/jpeg";

export const CodeImageUnreadable = "IMAGE_UNREADABLE";

/** Size that keeps the aspect ratio with the longest side at most maxSide; images are never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) {
    return { width, height };
  }
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
