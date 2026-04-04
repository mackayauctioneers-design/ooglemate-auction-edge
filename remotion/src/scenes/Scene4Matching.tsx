import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const Scene4Matching: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const headlineY = interpolate(
    spring({ frame, fps, config: { damping: 20, stiffness: 200 } }),
    [0, 1],
    [40, 0]
  );

  // Scanning animation
  const scanLineY = interpolate(frame, [30, 100], [0, 400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scanOpacity = interpolate(frame, [30, 40, 90, 100], [0, 0.6, 0.6, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lots = [
    { title: "2021 Hilux SR5", source: "Pickles", price: "$38,500", match: true },
    { title: "2019 CX-5 Touring", source: "Manheim", price: "$24,200", match: true },
    { title: "2020 Camry Ascent", source: "Grays", price: "$19,800", match: false },
    { title: "2020 Ranger XLT", source: "Pickles", price: "$32,100", match: true },
    { title: "2018 Corolla ZR", source: "Manheim", price: "$16,400", match: false },
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
        Step 02
      </div>

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
        We scan every auction
      </div>

      {/* Lot list with scanning */}
      <div style={{ position: "relative" }}>
        {/* Scan line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: scanLineY,
            height: 2,
            background: "linear-gradient(90deg, transparent, #fafafa, transparent)",
            opacity: scanOpacity,
            zIndex: 10,
          }}
        />

        {lots.map((lot, i) => {
          const delay = 20 + i * 12;
          const itemOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const isRevealed = frame > 70 + i * 8;
          const matchGlow = lot.match && isRevealed
            ? interpolate(frame, [70 + i * 8, 80 + i * 8], [0, 1], { extrapolateRight: "clamp" })
            : 0;

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 24px",
                marginBottom: 8,
                borderRadius: 12,
                background: lot.match && isRevealed
                  ? `rgba(250, 250, 250, ${0.06 * matchGlow})`
                  : "#141414",
                border: lot.match && isRevealed
                  ? `1px solid rgba(250, 250, 250, ${0.15 * matchGlow})`
                  : "1px solid #1a1a1a",
                opacity: itemOpacity,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div
                  style={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 24,
                    fontWeight: 500,
                    color: lot.match && isRevealed ? "#fafafa" : "#525252",
                  }}
                >
                  {lot.title}
                </div>
                <div
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 14,
                    color: "#525252",
                    background: "#0a0a0a",
                    padding: "3px 8px",
                    borderRadius: 4,
                  }}
                >
                  {lot.source}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 20,
                    color: "#a3a3a3",
                  }}
                >
                  {lot.price}
                </div>
                {lot.match && isRevealed && (
                  <div
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#fafafa",
                      background: "#262626",
                      padding: "4px 12px",
                      borderRadius: 6,
                      opacity: matchGlow,
                    }}
                  >
                    MATCH
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
