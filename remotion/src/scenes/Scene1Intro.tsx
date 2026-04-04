import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, staticFile, Img } from "remotion";

export const Scene1Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 15, stiffness: 80, mass: 2 } });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });

  const titleY = interpolate(
    spring({ frame: frame - 25, fps, config: { damping: 20, stiffness: 200 } }),
    [0, 1],
    [60, 0]
  );
  const titleOpacity = interpolate(frame, [25, 45], [0, 1], { extrapolateRight: "clamp" });

  const subtitleOpacity = interpolate(frame, [50, 70], [0, 1], { extrapolateRight: "clamp" });
  const subtitleY = interpolate(frame, [50, 70], [20, 0], { extrapolateRight: "clamp" });

  const lineWidth = interpolate(frame, [35, 65], [0, 300], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {/* Logo */}
      <div style={{ opacity: logoOpacity, transform: `scale(${logoScale})`, marginBottom: 40 }}>
        <Img
          src={staticFile("images/kiting-wing-mark.jpg")}
          style={{ width: 120, height: 120, borderRadius: 20 }}
        />
      </div>

      {/* Title */}
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 96,
          fontWeight: 700,
          color: "#fafafa",
          letterSpacing: -3,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        CARBITRAGE
      </div>

      {/* Divider line */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          background: "linear-gradient(90deg, transparent, #737373, transparent)",
          marginTop: 20,
          marginBottom: 20,
        }}
      />

      {/* Subtitle */}
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 24,
          color: "#737373",
          letterSpacing: 6,
          textTransform: "uppercase",
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
        }}
      >
        Auction Intelligence
      </div>
    </AbsoluteFill>
  );
};
