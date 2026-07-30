import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, PaperclipApiClient, buildUrl } from "../api.js";

describe("PaperclipApiClient", () => {
  it("builds API URLs without duplicating the API path", () => {
    expect(buildUrl("https://paperclip.example.com", "/api/companies")).toBe(
      "https://paperclip.example.com/api/companies",
    );
    expect(buildUrl("https://paperclip.example.com/api", "/api/health")).toBe(
      "https://paperclip.example.com/api/health",
    );
  });

  it("sends bearer auth and parses JSON responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "company-1", token: "must-not-print" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PaperclipApiClient({
      apiBase: "https://paperclip.example.com",
      apiKey: "secret-value",
    });
    await expect(client.get("/api/companies/company-1")).resolves.toEqual({
      id: "company-1",
      token: "must-not-print",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get("authorization")).toBe("Bearer secret-value");
    expect((init.headers as Headers).get("user-agent")).toContain("paperclip-cli/");
  });

  it("turns non-success responses into structured API errors without exposing bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Conflict", token: "secret-value" }), { status: 409 }),
      ),
    );

    const client = new PaperclipApiClient({ apiBase: "https://paperclip.example.com" });
    await expect(client.post("/api/issues/issue-1/checkout", {})).rejects.toMatchObject({
      status: 409,
      message: "Conflict",
    });
    await expect(client.post("/api/issues/issue-1/checkout", {})).rejects.not.toThrow("secret-value");
  });

  it("retries transient read failures but never retries mutations", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "company-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new PaperclipApiClient({
      apiBase: "https://paperclip.example.com",
      maxReadRetries: 1,
      retryDelayMs: 0,
    });
    await expect(client.get("/api/companies")).resolves.toEqual([{ id: "company-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ error: "busy" }), { status: 503 }));
    await expect(client.post("/api/companies/company-1/issues", { title: "one" })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
