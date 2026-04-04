import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const PersistentBackground: React.FC = () => {
  const frame = useCurrentFrame();

  const drift = interpolate(frame, [0, 600], [0, 40]);
  const drift2 = interpolate(frame, [0, 600], [0, -30]);

  return (
    <AbsoluteFill>
      {/* Base */}
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(145deg, #0a0a0a 0%, #141414 50%, #0a0a0a 100%)",
        }}
      />
      {/* Subtle moving grid lines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.04,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          transform: `translateY(${drift}px)`,
        }}
      />
      {/* Accent glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)",
          top: 200 + drift2,
          right: -100,
        }}
      />
    </AbsoluteFill>
  );
};
