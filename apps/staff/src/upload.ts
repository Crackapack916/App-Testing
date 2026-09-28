/**
 * Pack video uploads, straight from this browser to storage (brief item 11). The API only
 * hands out a one upload token and checks the result: video never passes through an API route.
 */
import { upload as blobUpload } from "@vercel/blob/client";
import { createSHA256 } from "hash-wasm";
import { api, token } from "./api";

const BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "/api" : "");
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,.mp4,.mov";
export type Kind = "blob" | "local";
export type Progress = (stage: string, pct: number) => void;

/** SHA-256 of the file, read in chunks so an hour long recording doesn't fill memory. */
export async function sha256(file: Blob, onProgress?: (pct: number) => void) {
  const h = await createSHA256();
  const CHUNK = 8 * 1024 * 1024;
  for (let at = 0; at < file.size; at += CHUNK) {
    h.update(new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer()));
    onProgress?.(Math.min(100, Math.round(((at + CHUNK) / file.size) * 100)));
  }
  return h.digest("hex");
}

export type Probe = { playable: boolean; durationMs: number | null; thumbnail: Blob | null };

/**
 * Checks this browser can play the file (iPhones record HEVC by default, which many browsers
 * can't), reads its duration, and grabs a thumbnail frame.
 */
export function probe(file: File): Promise<Probe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true;
    let settled = false;
    const done = (p: Probe) => { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute("src"); resolve(p); };
    const fail = () => done({ playable: false, durationMs: null, thumbnail: null });
    const timer = setTimeout(fail, 15_000);
    const grab = () => {
      const c = document.createElement("canvas");
      c.width = 480; c.height = Math.round((v.videoHeight / v.videoWidth) * 480);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const durationMs = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null;
      c.toBlob((b) => done({ playable: true, durationMs, thumbnail: b }), "image/jpeg", 0.8);
    };
    v.onerror = fail;
    // A decodable first frame means the browser can play it.
    v.onloadeddata = () => {
      if (!v.videoWidth) return fail();
      if (!Number.isFinite(v.duration) || v.duration < 2) return grab();
      v.onseeked = grab;
      v.currentTime = 1;
      setTimeout(() => { if (!settled) grab(); }, 3000);   // some files can't seek before they're fully read
    };
    v.src = url;
  });
}

/** Sends one file to storage at a path the server fixed, reporting progress. */
export async function put(kind: Kind, pathname: string, body: Blob, contentType: string, onPct: (pct: number) => void) {
  const auth = { authorization: `Bearer ${token.get()}` };
  if (kind === "blob") {
    // Multipart splits large files into parts and retries failed parts.
    await blobUpload(pathname, body, { access: "private", handleUploadUrl: `${BASE}/staff/videos/token`, headers: auth, contentType,
      multipart: body.size > 20 * 1024 * 1024, onUploadProgress: (e) => onPct(Math.round(e.percentage)) });
    return;
  }
  const { uploadUrl } = await api<{ uploadUrl: string }>("POST", "/staff/videos/token", { pathname });
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", BASE + uploadUrl);
    x.setRequestHeader("authorization", auth.authorization);
    x.setRequestHeader("content-type", contentType);
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(JSON.parse(x.responseText || "{}").message ?? `Upload failed (${x.status})`)));
    x.onerror = () => reject(new Error("Upload failed. Check the connection and retry."));
    x.send(body);
  });
}

const ext = (f: File) => (f.type === "video/quicktime" || /\.mov$/i.test(f.name) ? "mov" : "mp4");
const typeOf = (f: File) => (ext(f) === "mov" ? "video/quicktime" : "video/mp4");

/** The whole flow for one pack: check, hash, upload video and thumbnail, then record it. */
export async function uploadPackVideo(kind: Kind, packId: string, file: File, progress: Progress) {
  if (!/\.(mp4|mov)$/i.test(file.name) && !["video/mp4", "video/quicktime"].includes(file.type)) throw new Error("Use an mp4 or mov file.");
  progress("Checking", 0);
  const p = await probe(file);
  if (!p.playable) throw new Error("This browser can't play that file, so customers couldn't either. It's probably HEVC. On the iPhone, set Settings, Camera, Formats to Most Compatible and record again, or export as H.264 mp4.");
  const hash = await sha256(file, (pct) => progress("Hashing", pct));
  await api("POST", `/staff/packs/${packId}/video/start`);
  const pathname = `packs/${packId}.${ext(file)}`;
  await put(kind, pathname, file, typeOf(file), (pct) => progress("Uploading", pct));
  let thumbnail: string | null = null;
  if (p.thumbnail) {
    thumbnail = `thumbs/${packId}.jpg`;
    await put(kind, thumbnail, p.thumbnail, "image/jpeg", () => {});
  }
  progress("Saving", 100);
  await api("POST", `/staff/packs/${packId}/video/finish`, { pathname, size: file.size, sha256: hash, duration_ms: p.durationMs,
    content_type: typeOf(file), thumbnail, recorded_at: new Date(file.lastModified).toISOString() });
}

/** The optional one file recording of the whole session, kept private for chain of custody. */
export async function uploadSessionMaster(kind: Kind, batchId: string, file: File, progress: Progress) {
  const hash = await sha256(file, (pct) => progress("Hashing", pct));
  const pathname = `masters/${batchId}.${ext(file)}`;
  await put(kind, pathname, file, typeOf(file), (pct) => progress("Uploading", pct));
  await api("POST", `/staff/batches/${batchId}/session-master`, { pathname, size: file.size, sha256: hash });
}
