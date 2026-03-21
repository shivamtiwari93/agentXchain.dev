import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

describe("Auth API", () => {
  it("POST /auth/register creates a user and returns a token", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "new@example.com", password: "password123", name: "N" })
      .expect(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: "new@example.com", name: "N" });
  });

  it("POST /auth/register returns 409 for duplicate email", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    await request(app)
      .post("/auth/register")
      .send({ email: "dup@example.com", password: "password123", name: "A" })
      .expect(201);
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "dup@example.com", password: "password123", name: "B" })
      .expect(409);
    expect(res.body.error).toMatch(/email/i);
  });

  it("POST /auth/register rejects weak password", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "weak@example.com", password: "short", name: "W" })
      .expect(400);
    expect(res.body.error).toMatch(/8/);
  });

  it("POST /auth/login returns token for valid credentials", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    await request(app)
      .post("/auth/register")
      .send({ email: "login@example.com", password: "password123", name: "L" })
      .expect(201);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "login@example.com", password: "password123" })
      .expect(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("login@example.com");
  });

  it("POST /auth/login returns 401 for invalid credentials", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    await request(app)
      .post("/auth/register")
      .send({ email: "x@example.com", password: "password123", name: "X" })
      .expect(201);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "x@example.com", password: "wrongpass" })
      .expect(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("POST /auth/logout invalidates the JWT (token version bump)", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const reg = await request(app)
      .post("/auth/register")
      .send({ email: "out@example.com", password: "password123", name: "O" })
      .expect(201);
    const token = reg.body.token as string;
    await request(app).post("/auth/logout").set("Authorization", `Bearer ${token}`).expect(204);
    await request(app).get("/babies").set("Authorization", `Bearer ${token}`).expect(401);
  });

  it("POST /auth/forgot-password returns 200", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const res = await request(app).post("/auth/forgot-password").send({ email: "any@example.com" }).expect(200);
    expect(res.body.ok).toBe(true);
  });
});
