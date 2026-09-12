import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "@/worker/crypto";

describe("凭据加密", () => {
  it("使用 AAD 完成 AES-GCM 往返并拒绝错误上下文", async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const encrypted = await encryptCredential({ token: "secret" }, key, "integration:codex:1");
    await expect(
      decryptCredential(encrypted.encryptedPayload, encrypted.nonce, key, "integration:codex:1"),
    ).resolves.toEqual({ token: "secret" });
    await expect(
      decryptCredential(encrypted.encryptedPayload, encrypted.nonce, key, "other:codex:1"),
    ).rejects.toThrow();
  });
});
