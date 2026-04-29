import { initPixel } from "@kenkaiiii/gg-pixel";

const key = process.env.GG_PIXEL_KEY;
if (key) {
  initPixel({
    projectKey: key,
    sink: { kind: "http", ingestUrl: "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest" },
  });
}
