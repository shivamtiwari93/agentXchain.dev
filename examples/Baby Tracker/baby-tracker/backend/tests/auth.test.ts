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
    expect(res.body.user).toMatchObject({ email: "new@example.com", name: "N" });
    expect(res.headers["set-cookie"]).toBeTruthy();
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
    expect(res.body.user.email).toBe("login@example.com");
    expect(res.headers["set-cookie"]).toBeTruthy();
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

  it("POST /auth/login accepts email with surrounding whitespace", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    await request(app)
      .post("/auth/register")
      .send({ email: "trim@example.com", password: "password123", name: "Trim" })
      .expect(201);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "  trim@example.com  ", password: "password123" })
      .expect(200);
    expect(res.body.user.email).toBe("trim@example.com");
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

  it("GET /auth/session returns the authenticated user from the session cookie", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const reg = await request(app)
      .post("/auth/register")
      .send({ email: "session@example.com", password: "password123", name: "S" })
      .expect(201);
    const cookie = reg.headers["set-cookie"];
    expect(cookie).toBeTruthy();

    const res = await request(app)
      .get("/auth/session")
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body.user).toMatchObject({ email: "session@example.com", name: "S" });
  });

  it("POST /auth/login returns 429 after repeated failed attempts for the same account", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    await request(app)
      .post("/auth/register")
      .send({ email: "limit@example.com", password: "password123", name: "Limit" })
      .expect(201);

    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post("/auth/login")
        .send({ email: "limit@example.com", password: "wrongpass" })
        .expect(401);
    }

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "limit@example.com", password: "wrongpass" })
      .expect(429);

    expect(res.body.error).toMatch(/too many requests/i);
    expect(res.headers["retry-after"]).toBeTruthy();
  });

  it("POST /auth/forgot-password returns 200", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const res = await request(app).post("/auth/forgot-password").send({ email: "any@example.com" }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/not configured/i);
  });

  it("POST /auth/forgot-password returns 400 when email is missing", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const res = await request(app).post("/auth/forgot-password").send({}).expect(400);
    expect(res.body.error).toMatch(/email is required/i);
  });
});
