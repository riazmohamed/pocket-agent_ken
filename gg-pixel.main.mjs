import { initPixel } from "@kenkaiiii/gg-pixel";

const key = process.env.GG_PIXEL_KEY || "pk_live_f0f0b8e539537487522cdd7db1b14b25";
if (key) {
  initPixel({
    projectKey: key,
    sink: { kind: "http", ingestUrl: "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest" },
  });
}
