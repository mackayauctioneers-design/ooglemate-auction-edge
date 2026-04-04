import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const Scene2Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineX = interpolate(
    spring({ frame, fps, config: { damping: 20, stiffness: 200 } }),
    [0, 1],
    [-400, 0]
  );
  const headlineOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  const items = [
    "Thousands of auction lots every week",
    "Manual searching wastes hours",
    "Good deals disappear in minutes",
  ];

  return (
    <AbsoluteFill style={{ padding: 120 }}>
      {/* Headline */}
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 64,
          fontWeight: 700,
          color: "#fafafa",
          letterSpacing: -2,
          opacity: headlineOpacity,
          transform: `translateX(${headlineX}px)`,
          marginBottom: 60,
        }}
      >
        The Problem
      </div>

      {/* Pain points */}
      {items.map((item, i) => {
        const delay = 25 + i * 20;
        const itemOpacity = interpolate(frame, [delay, delay + 15], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const itemX = interpolate(frame, [delay, delay + 15], [80, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              marginBottom: 32,
              opacity: itemOpacity,
              transform: `translateX(${itemX}px)`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#737373",
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 36,
                color: "#a3a3a3",
                fontWeight: 400,
              }}
            >
              {item}
            </div>
          </div>
        );
      })}

      {/* Accent line */}
      <div
        style={{
          position: "absolute",
          left: 120,
          bottom: 120,
          width: interpolate(frame, [80, 110], [0, 500], { extrapolateRight: "clamp" }),
          height: 1,
          background: "#404040",
        }}
      />
    </AbsoluteFill>
  );
};
