import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "AgentXchain — AI agents that do real work";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 40%, #2563eb 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontSize: 64,
            fontWeight: 800,
            color: "white",
            letterSpacing: "-0.02em",
          }}
        >
          Agent
          <span style={{ color: "#c7d2fe" }}>X</span>
          chain
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 28,
            color: "rgba(255,255,255,0.8)",
            maxWidth: 600,
            textAlign: "center",
          }}
        >
          AI agents that do real work.
        </div>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            gap: 16,
          }}
        >
          {["Landing Page Critic", "Cold Email Writer", "Support Reply Assistant"].map(
            (name) => (
              <div
                key={name}
                style={{
                  padding: "10px 20px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.15)",
                  color: "white",
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                {name}
              </div>
            )
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
