import fs from "node:fs";
import path from "node:path";
import { HOW_TO_VIDEOS, type HowToVideo } from "@/lib/how-to-videos";

const exists = (src: string) => fs.existsSync(path.join(process.cwd(), "public", src));

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
