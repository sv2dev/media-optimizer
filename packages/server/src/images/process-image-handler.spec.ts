import type {
  ProcessingError,
  Progress,
  QueuePosition,
  RemoteImageOptions,
} from "@m4k/common";
import { streamParts } from "@sv2dev/multipart-stream";
import { describe, expect, it } from "bun:test";
import { processImageHandler } from "./process-image-handler";

const fixture = Bun.file("../../fixtures/image.jpeg");
const avifFixture = Bun.file("../../fixtures/image.avif");

describe("/process", () => {
  it("should process a single image", async () => {
    const opts: RemoteImageOptions = {
      resize: { width: 100, height: 1000 },
      format: "jpeg",
    };
    const response = await processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
        headers: { "X-Options": JSON.stringify(opts) },
      })
    );

    expect(response.status).toBe(200);
    const collected = await collectResponse(response);

    expect(collected).toEqual([
      { position: 0 },
      { progress: 0 },
      { filename: "file1.jpeg", type: "image/jpeg", size: 704 },
      { progress: 100 },
    ]);
  }, 1000);

  it("should stream the queue position", async () => {
    const opts: RemoteImageOptions = {
      resize: { width: 100, height: 1000 },
      format: "avif",
    };
    const r1 = processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
        headers: { "X-Options": JSON.stringify(opts) },
      })
    );
    const r2 = processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
        headers: { "X-Options": JSON.stringify(opts) },
      })
    );

    const collected1 = await collectResponse(await r1);
    const collected2 = await collectResponse(await r2);

    expect(collected1).toEqual([
      { position: 0 },
      { progress: 0 },
      { filename: "file1.avif", type: "image/avif", size: 530 },
      { progress: 100 },
    ]);
    expect(collected2).toEqual([
      { position: 0 },
      { progress: 0 },
      { filename: "file1.avif", type: "image/avif", size: 530 },
      { progress: 100 },
    ]);
  });

  it("should throw if format is invalid", async () => {
    const opts: RemoteImageOptions = {
      format: "x" as any,
    };
    const res = await processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
        headers: { "X-Options": JSON.stringify(opts) },
      })
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toEqual("[/format] Expected union value");
  });

  it("should return 400 if no options are provided", async () => {
    const res = await processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
      })
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("No options provided");
  });

  it("should return 400 if X-Options header is not valid JSON", async () => {
    const res = await processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
        headers: { "X-Options": "{" },
      })
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Error while parsing options");
  });

  it("should process multiple images", async () => {
    const opts: RemoteImageOptions[] = [
      {
        resize: { width: 100, height: 100 },
        format: "avif",
        quality: 40,
      },
      {
        resize: { width: 100, height: 100 },
        format: "webp",
        quality: 40,
      },
    ];
    const response = await processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
        headers: { "X-Options": JSON.stringify(opts) },
      })
    );

    const collected = await collectResponse(response);

    expect(response.status).toBe(200);
    expect(collected).toEqual([
      { position: 0 },
      { progress: 0 },
      { filename: "file1.avif", type: "image/avif", size: 487 },
      { progress: 50 },
      { filename: "file2.webp", type: "image/webp", size: 204 },
      { progress: 100 },
    ]);
  });

  it("should convert avif to avif", async () => {
    const opts: RemoteImageOptions = {
      format: "avif",
    };
    const response = await processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: avifFixture,
        headers: { "X-Options": JSON.stringify(opts) },
      })
    );

    expect(response.status).toBe(200);
    const collected = await collectResponse(response);

    expect(collected).toEqual([
      { position: 0 },
      { progress: 0 },
      expect.objectContaining({ filename: "file1.avif", type: "image/avif" }),
      { progress: 100 },
    ]);
  });

  it("should not stream back, if output is provided", async () => {
    const opts: RemoteImageOptions = {
      format: "avif",
      output: "/tmp/test-output.avif",
    };

    const response = await processImageHandler(
      new Request(`http://localhost:3000/images/process`, {
        method: "POST",
        body: fixture,
        headers: { "X-Options": JSON.stringify(opts) },
      })
    );

    expect(response.status).toBe(200);
    let notifications: (QueuePosition | Progress)[] = [];
    for await (const part of streamParts(response)) {
      if (part.type === "application/json") {
        notifications.push((await part.json()) as QueuePosition | Progress);
      }
    }
    expect(notifications[0]).toEqual({ position: 0 });
    expect(notifications[1]).toEqual({ progress: 0 });
    const file = Bun.file("/tmp/test-output.avif");
    expect(file.size).toBeGreaterThan(1000);
    await file.unlink();
  });
});

async function collectResponse(response: Response) {
  const collected: (
    | QueuePosition
    | Progress
    | ProcessingError
    | { filename: string; type: string; size: number }
  )[] = [];
  for await (const part of streamParts(response)) {
    if (part.type === "application/json") {
      collected.push(
        (await part.json()) as QueuePosition | Progress | ProcessingError
      );
    } else if (part.type === "text/plain") {
      continue; // keepalive
    } else {
      const bytes = await part.bytes();
      collected.push({
        filename: part.filename!,
        type: part.type!,
        size: bytes.length,
      });
    }
  }
  return collected;
}
