import test from "node:test";
import assert from "node:assert/strict";
import { detectImageType } from "../src/images.js";

test("detects supported image formats from file signatures", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), "image/png");
  assert.equal(detectImageType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(detectImageType(Buffer.from("RIFFxxxxWEBP")), "image/webp");
});

test("rejects content that merely claims to be an image", () => {
  assert.equal(detectImageType(Buffer.from("<svg onload=alert(1)>")), null);
  assert.equal(detectImageType(Buffer.from("not an image")), null);
});
