import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, staticFile, Img } from "remotion";

export const Scene5Result: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  // Alert card
  const cardScale = spring({ frame: frame - 20, fps, config: { damping: 12, stiffness: 150 } });
  const cardOpacity = interpolate(frame, [20, 35], [0, 1], { extrapolateRight: "clamp" });

  // Stats
  const stats = [
    { label: "Est. Margin", value: "$4,300" },
    { label: "Passed In", value: "3×" },
    { label: "Confidence", value: "BUY" },
  ];

  // Closing tagline
  const taglineOpacity = interpolate(frame, [90, 110], [0, 1], { extrapolateRight: "clamp" });
  const taglineY = interpolate(frame, [90, 110], [30, 0], { extrapolateRight: "clamp" });

  // Logo at end
  const logoOpacity = interpolate(frame, [110, 130], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {/* Step label */}
      <div
        style={{
          position: "absolute",
          top: 120,
          left: 120,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 18,
          color: "#737373",
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: headlineOpacity,
        }}
      >
        Result
      </div>

      {/* Alert card */}
      <div
        style={{
          background: "#141414",
          border: "1px solid #2a2a2a",
          borderRadius: 24,
          padding: 60,
          width: 900,
          opacity: cardOpacity,
          transform: `scale(${cardScale})`,
        }}
      >
        {/* Alert type badge */}
        <div
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 14,
            fontWeight: 600,
            color: "#fafafa",
            background: "#262626",
            padding: "6px 16px",
            borderRadius: 8,
            display: "inline-block",
            marginBottom: 24,
            letterSpacing: 2,
          }}
        >
          🔔 WHATSAPP ALERT
        </div>

        {/* Vehicle info */}
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 42,
            fontWeight: 700,
            color: "#fafafa",
            marginBottom: 8,
          }}
        >
          2021 Toyota Hilux SR5
        </div>
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 22,
            color: "#737373",
            marginBottom: 36,
          }}
        >
          Pickles Brisbane · Auction Tomorrow 10:00 AM
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 40 }}>
          {stats.map((stat, i) => {
            const delay = 40 + i * 12;
            const statOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div key={i} style={{ opacity: statOpacity }}>
                <div
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 14,
                    color: "#525252",
                    textTransform: "uppercase",
                    letterSpacing: 2,
                    marginBottom: 8,
                  }}
                >
                  {stat.label}
                </div>
                <div
                  style={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 36,
                    fontWeight: 700,
                    color: stat.label === "Confidence" ? "#fafafa" : "#a3a3a3",
                  }}
                >
                  {stat.value}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Closing tagline */}
      <div
        style={{
          marginTop: 60,
          textAlign: "center",
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 36,
            fontWeight: 600,
            color: "#fafafa",
            marginBottom: 12,
          }}
        >
          Know what to buy, before anyone else.
        </div>
        <div
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 18,
            color: "#525252",
            letterSpacing: 4,
          }}
        >
          carbitrage.com.au
        </div>
      </div>

      {/* Logo */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          opacity: logoOpacity,
        }}
      >
        <Img
          src={staticFile("images/kiting-wing-mark.jpg")}
          style={{ width: 48, height: 48, borderRadius: 10 }}
        />
      </div>
    </AbsoluteFill>
  );
};
