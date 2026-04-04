import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const Scene3Fingerprints: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const headlineY = interpolate(
    spring({ frame, fps, config: { damping: 20, stiffness: 200 } }),
    [0, 1],
    [40, 0]
  );

  const fingerprints = [
    { make: "Toyota", model: "Hilux SR5", year: "2019-2022", km: "< 120k" },
    { make: "Mazda", model: "CX-5 Touring", year: "2020-2023", km: "< 80k" },
    { make: "Ford", model: "Ranger XLT", year: "2018-2021", km: "< 150k" },
  ];

  return (
    <AbsoluteFill style={{ padding: 120 }}>
      {/* Label */}
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 18,
          color: "#737373",
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: headlineOpacity,
          marginBottom: 16,
        }}
      >
        Step 01
      </div>

      {/* Headline */}
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 56,
          fontWeight: 700,
          color: "#fafafa",
          letterSpacing: -2,
          opacity: headlineOpacity,
          transform: `translateY(${headlineY}px)`,
          marginBottom: 50,
        }}
      >
        We learn what you sell
      </div>

      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 26,
          color: "#737373",
          marginBottom: 50,
          opacity: interpolate(frame, [15, 30], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        Upload your sales history → we build your dealer fingerprint
      </div>

      {/* Fingerprint cards */}
      <div style={{ display: "flex", gap: 30 }}>
        {fingerprints.map((fp, i) => {
          const delay = 30 + i * 18;
          const cardScale = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 200 } });
          const cardOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={i}
              style={{
                flex: 1,
                background: "#1a1a1a",
                border: "1px solid #2a2a2a",
                borderRadius: 16,
                padding: 32,
                opacity: cardOpacity,
                transform: `scale(${cardScale})`,
              }}
            >
              <div
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 28,
                  fontWeight: 600,
                  color: "#fafafa",
                  marginBottom: 8,
                }}
              >
                {fp.make}
              </div>
              <div
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 22,
                  color: "#a3a3a3",
                  marginBottom: 16,
                }}
              >
                {fp.model}
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 14,
                    color: "#737373",
                    background: "#0a0a0a",
                    padding: "4px 10px",
                    borderRadius: 6,
                  }}
                >
                  {fp.year}
                </div>
                <div
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 14,
                    color: "#737373",
                    background: "#0a0a0a",
                    padding: "4px 10px",
                    borderRadius: 6,
                  }}
                >
                  {fp.km}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
