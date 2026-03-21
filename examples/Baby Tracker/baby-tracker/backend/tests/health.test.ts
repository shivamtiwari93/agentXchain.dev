import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

describe("GET /health", () => {
  it("returns { status: ok }", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects POST /health", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    await request(app).post("/health").expect(404);
  });
});
