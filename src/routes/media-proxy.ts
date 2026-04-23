import express from "express";
import type { Request, Response } from "express";
import { config } from "../config/index.js";

// mediamtx WebRTC (WHIP/WHEP) endpoint — port 8889
const mediamtxWebRtcBase = config.mediamtxWebRtcUrl.replace(/\/+$/, "");

export function createMediaProxyRouter(): express.Router {
  const router = express.Router();

  router.post("/whip/:roomId/:memberId", proxyToMedia("/whip"));
  router.post("/whep/:roomId/:memberId", proxyToMedia("/whep"));
  router.delete("/whip/:roomId/:memberId", proxyToMedia("/whip"));
  router.delete("/whep/:roomId/:memberId", proxyToMedia("/whep"));

  return router;
}

function proxyToMedia(suffix: string): (req: Request, res: Response) => void {
  return async (req: Request, res: Response) => {
    const { roomId, memberId } = req.params;
    const path = `room/${roomId}/${memberId}`;
    const targetUrl = `${mediamtxWebRtcBase}/${path}${suffix}`;

    try {
      const fetchOptions: RequestInit = {
        method: req.method,
      };

      if (req.method === "POST") {
        const body = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });
        fetchOptions.body = body;
        fetchOptions.headers = { "Content-Type": "application/sdp" };
      }

      console.log(`[media-proxy] ${req.method} ${targetUrl}`);
      const response = await fetch(targetUrl, fetchOptions);

      res.status(response.status);

      const contentType = response.headers.get("content-type");
      if (contentType) res.set("Content-Type", contentType);

      const location = response.headers.get("location");
      if (location) res.set("Location", location);

      const text = await response.text();
      res.send(text);

      if (response.ok) {
        console.log(`[media-proxy] ${req.method} ${targetUrl} → ${response.status}`);
      } else {
        console.warn(`[media-proxy] mediamtx responded ${response.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[media-proxy] Failed to proxy ${req.method} ${targetUrl}:`, err);
      res.status(502).json({ error: "Media server proxy failed", detail: String(err) });
    }
  };
}
