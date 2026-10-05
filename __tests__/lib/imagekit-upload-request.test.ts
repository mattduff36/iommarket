import { describe, expect, it } from "vitest";
import { readUploadJson } from "@/lib/media/upload-request";
function request(body: string, headers: Record<string, string> = {}) { return new Request("https://itrader.dev/api/upload", { method: "POST", body, headers }); }

describe("bounded image upload metadata requests", () => {
  it("accepts metadata and an explicitly allowed empty legacy intent", async () => {
    expect(await readUploadJson(request('{"fileId":"file"}'))).toEqual({ fileId: "file" });
    expect(await readUploadJson(new Request("https://itrader.dev", { method: "POST" }), true)).toEqual({});
  });
  it("rejects oversized streaming bodies even without content-length", async () => {
    await expect(readUploadJson(request(JSON.stringify({ fileId: "x".repeat(2048) })))).rejects.toThrow();
  });
  it("counts bytes rather than Unicode characters", async () => {
    await expect(readUploadJson(request(JSON.stringify({ name: "é".repeat(1100) })))).rejects.toThrow();
  });
  it("rejects malformed JSON, forbidden empty requests and invalid size declarations", async () => {
    await expect(readUploadJson(request("{"))).rejects.toThrow();
    await expect(readUploadJson(request(""))).rejects.toThrow();
    for (const value of ["9000", "-1", "invalid"]) await expect(readUploadJson(request("{}", { "content-length": value }))).rejects.toThrow();
  });
});
