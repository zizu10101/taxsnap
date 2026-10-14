import fs from "node:fs";
import path from "node:path";
import { HOW_TO_VIDEOS, type HowToVideo } from "@/lib/how-to-videos";

const exists = (src: string) => fs.existsSync(path.join(process.cwd(), "public", src));

/**
 * FAQ items with a link to their how-to video attached, for the items whose video is
 * published (not hidden, mp4 present). Server only, so the client accordion just renders it.
 */
export function withVideoLinks<T extends { videoSlug?: string }>(
  items: T[],
): (Omit<T, "videoSlug"> & { link?: { href: string; label: string } })[] {
  const available = new Map(availableHowToVideos().map((v) => [v.slug, v]));
  return items.map(({ videoSlug, ...item }) => {
    const video = videoSlug ? available.get(videoSlug) : undefined;
    return video
      ? { ...item, link: { href: `/how-to/${video.slug}`, label: `Watch: ${video.title}` } }
      : item;
  });
}

/**
 * The videos to publish (server only): not `hidden`, and with their mp4 actually
 * in public/videos/. Everything that lists or routes videos goes through this.
 * A missing poster is just dropped.
 */
export function availableHowToVideos(): (Omit<HowToVideo, "poster"> & { poster?: string })[] {
  return HOW_TO_VIDEOS.filter((v) => !v.hidden && exists(v.mp4)).map((v) => ({
    ...v,
    poster: exists(v.poster) ? v.poster : undefined,
  }));
}
