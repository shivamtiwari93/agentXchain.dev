import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

async function register(
  app: ReturnType<typeof createApp>,
  email: string,
): Promise<string> {
  const res = await request(app)
    .post("/auth/register")
    .send({ email, password: "password123", name: "User" })
    .expect(201);
  return res.body.token as string;
}

describe("Babies API", () => {
  it("GET /babies returns 401 without token", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    await request(app).get("/babies").expect(401);
  });

  it("POST /babies creates a baby and GET lists it", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const token = await register(app, "parent@example.com");
    const created = await request(app)
      .post("/babies")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Sam", date_of_birth: "2024-01-15", gender: "female" })
      .expect(201);
    expect(created.body.name).toBe("Sam");
    const list = await request(app).get("/babies").set("Authorization", `Bearer ${token}`).expect(200);
    expect(list.body.babies).toHaveLength(1);
    expect(list.body.babies[0].id).toBe(created.body.id);
  });

  it("PUT /babies/:id updates when user is a caregiver", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const token = await register(app, "u@example.com");
    const created = await request(app)
      .post("/babies")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Sam", date_of_birth: "2024-01-15", gender: "female" })
      .expect(201);
    const updated = await request(app)
      .put(`/babies/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Samuel" })
      .expect(200);
    expect(updated.body.name).toBe("Samuel");
  });

  it("DELETE /babies/:id forbids non-creator", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const t1 = await register(app, "a@example.com");
    const created = await request(app)
      .post("/babies")
      .set("Authorization", `Bearer ${t1}`)
      .send({ name: "Kid", date_of_birth: "2024-02-01", gender: "male" })
      .expect(201);
    const t2 = await register(app, "b@example.com");
    const res = await request(app)
      .delete(`/babies/${created.body.id}`)
      .set("Authorization", `Bearer ${t2}`)
      .expect(403);
    expect(res.body.error).toMatch(/creator/i);
  });

  it("DELETE /babies/:id allows creator", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(db);
    const token = await register(app, "c@example.com");
    const created = await request(app)
      .post("/babies")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Kid", date_of_birth: "2024-02-01", gender: "male" })
      .expect(201);
    await request(app).delete(`/babies/${created.body.id}`).set("Authorization", `Bearer ${token}`).expect(204);
    const list = await request(app).get("/babies").set("Authorization", `Bearer ${token}`).expect(200);
    expect(list.body.babies).toHaveLength(0);
  });
});
