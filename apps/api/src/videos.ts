/**
 * Pack videos live in Vercel Blob, private. Staff browsers upload straight to storage with a
 * short lived client token (never through an API route: Vercel functions reject bodies over
 * about 4.5 MB). Customers and staff watch through expiring signed links.
 */
import { head, issueSignedToken, presignUrl } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_VIDEO_BYTES = 2 * 1024 ** 3;   // 2 GB: a per pack video is minutes, a session master about an hour

export interface VideoStorage {
  /** blob: the browser uploads to Vercel Blob. local: pilot and tests only, the browser PUTs to the API. */
  readonly kind: "blob" | "local";
  /** Answers the browser's token request for one upload. `authorize` returns false to refuse. */
  clientUpload(request: Request, body: unknown, authorize: (pathname: string) => Promise<boolean>): Promise<unknown>;
  /** Size of a stored file, or null if it isn't there. */
  sizeOf(pathname: string): Promise<number | null>;
  /** A link that works for `seconds`, then stops. */
  signedUrl(pathname: string, seconds: number): Promise<string>;
}

export function blobStorage(token: string): VideoStorage {
  return {
    kind: "blob",
    async clientUpload(request, body, authorize) {
      return handleUpload({
        token, request, body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname) => {
          if (!(await authorize(pathname))) throw new Error("forbidden");
          return { allowedContentTypes: [...VIDEO_TYPES, ...IMAGE_TYPES], maximumSizeInBytes: MAX_VIDEO_BYTES, addRandomSuffix: false, allowOverwrite: true };
        },
        // The staff browser reports completion itself (finish route), which also verifies the size here.
        onUploadCompleted: async () => {},
      });
    },
    async sizeOf(pathname) {
      try { return (await head(pathname, { token })).size; } catch { return null; }
    },
    async signedUrl(pathname, seconds) {
      const validUntil = Date.now() + seconds * 1000;
      const t = await issueSignedToken({ token, pathname, operations: ["get"], validUntil });
      return (await presignUrl(t, { operation: "get", pathname, access: "private", validUntil })).presignedUrl;
    },
  };
}

/**
 * Pilot and test storage on local disk: the staff browser PUTs the file to
 * /staff/videos/local/<pathname>, and playback uses HMAC signed links that expire.
 * Refused in production (build.ts); never used on Vercel, whose disk doesn't persist.
 */
export function localVideos(dir: string, secret: string): VideoStorage & { file(pathname: string): string; verify(pathname: string, exp: string, sig: string): boolean } {
  const sign = (pathname: string, exp: number) => createHmac("sha256", secret).update(`${pathname}:${exp}`).digest("hex");
  const file = (pathname: string) => {
    const full = resolve(dir, pathname);
    if (!full.startsWith(resolve(dir) + sep)) throw new Error("forbidden");
    return full;
  };
  return {
    kind: "local",
    async clientUpload(_request, body, authorize) {
      const pathname = (body as { pathname?: string })?.pathname ?? "";
      if (!(await authorize(pathname))) throw new Error("forbidden");
      return { uploadUrl: `/staff/videos/local/${pathname}` };
    },
    async sizeOf(pathname) {
      try { return (await stat(file(pathname))).size; } catch { return null; }
    },
    async signedUrl(pathname, seconds) {
      const exp = Math.floor(Date.now() / 1000) + seconds;
      return `/videos/local/${pathname}?exp=${exp}&sig=${sign(pathname, exp)}`;
    },
    file,
    verify(pathname, exp, sig) {
      const want = sign(pathname, Number(exp));
      return Number(exp) > Date.now() / 1000 && sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
    },
  };
}
