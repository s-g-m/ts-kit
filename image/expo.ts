import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
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
 * Opens the photo library and returns the chosen image reduced to a JPEG of at most limits.maxSide and its thumbnail,
 * or null when the user cancels. The system picker needs no permission prompt on iOS 14+ and Android 13+.
 */
export async function pickImage(
  limits: ImageLimits = DEFAULT_IMAGE_LIMITS,
): Promise<PreparedImage | null> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    exif: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) {
    return null;
  }
  try {
    const size = fitWithin(asset.width, asset.height, limits.maxSide);
    const thumbSize = fitWithin(asset.width, asset.height, limits.thumbSide);
    const [image, thumb] = await Promise.all([
      resize(asset.uri, size, limits.quality),
      resize(asset.uri, thumbSize, limits.quality),
    ]);
    return { image, thumb, mime: PREPARED_IMAGE_MIME, ...size };
  } catch (err) {
    const failure = newError(CodeImageUnreadable, "the image could not be reduced").badRequest();
    failure.wrap(err);
    throw failure;
  }
}

async function resize(
  uri: string,
  size: { width: number; height: number },
  quality: number,
): Promise<Blob> {
  const rendered = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  const response = await fetch(saved.uri);
  return response.blob();
}
