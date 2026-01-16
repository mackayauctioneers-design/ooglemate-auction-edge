import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Custom action colors
        "action-buy": "hsl(var(--action-buy))",
        "action-buy-foreground": "hsl(var(--action-buy-foreground))",
        "action-watch": "hsl(var(--action-watch))",
        "action-watch-foreground": "hsl(var(--action-watch-foreground))",
        // Status colors
        "status-passed": "hsl(var(--status-passed))",
        "status-sold": "hsl(var(--status-sold))",
        "status-listed": "hsl(var(--status-listed))",
        "status-withdrawn": "hsl(var(--status-withdrawn))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        // Kiting Mode Animations
        "kiting-hover": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
        "kiting-scan": {
          "0%, 100%": { transform: "translateY(0) scale(1)" },
          "25%": { transform: "translateY(-2px) scale(1.02)" },
          "75%": { transform: "translateY(2px) scale(0.98)" },
        },
        "kiting-dive": {
          "0%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(8px) rotate(15deg)" },
          "100%": { transform: "translateY(4px) rotate(5deg)" },
        },
        "kiting-strike": {
          "0%": { transform: "translateY(0) scale(1)" },
          "20%": { transform: "translateY(12px) scale(1.1)" },
          "40%": { transform: "translateY(6px) scale(1.05)" },
          "100%": { transform: "translateY(0) scale(1)" },
        },
        "kiting-flash": {
          "0%": { opacity: "0.8" },
          "100%": { opacity: "0" },
        },
        "kiting-radar": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        // Wing Mark Animations (new symmetrical design)
        "wing-left": {
          "0%, 100%": { transform: "scaleX(1) rotate(0deg)" },
          "50%": { transform: "scaleX(1.03) rotate(-2deg)" },
        },
        "wing-right": {
          "0%, 100%": { transform: "scaleX(1) rotate(0deg)" },
          "50%": { transform: "scaleX(1.03) rotate(2deg)" },
        },
        "wing-left-fast": {
          "0%, 100%": { transform: "scaleX(1) rotate(0deg)" },
          "25%": { transform: "scaleX(1.05) rotate(-3deg)" },
          "75%": { transform: "scaleX(0.97) rotate(1deg)" },
        },
        "wing-right-fast": {
          "0%, 100%": { transform: "scaleX(1) rotate(0deg)" },
          "25%": { transform: "scaleX(1.05) rotate(3deg)" },
          "75%": { transform: "scaleX(0.97) rotate(-1deg)" },
        },
        "wing-dive-left": {
          "0%": { transform: "rotate(0deg) translateY(0)" },
          "100%": { transform: "rotate(15deg) translateY(3px)" },
        },
        "wing-dive-right": {
          "0%": { transform: "rotate(0deg) translateY(0)" },
          "100%": { transform: "rotate(-15deg) translateY(3px)" },
        },
        "wing-strike": {
          "0%": { transform: "scale(1)" },
          "30%": { transform: "scale(1.15)" },
          "60%": { transform: "scale(0.95)" },
          "100%": { transform: "scale(1)" },
        },
        "tail-dive": {
          "0%": { transform: "translateY(0) scaleY(1)" },
          "100%": { transform: "translateY(5px) scaleY(1.1)" },
        },
        "tail-strike": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.2)" },
          "100%": { transform: "scale(1)" },
        },
        // Legacy wing animations (kept for compatibility)
        "wing-flap-left": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "50%": { transform: "rotate(-8deg)" },
        },
        "wing-flap-right": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "50%": { transform: "rotate(8deg)" },
        },
        "wing-flap-left-fast": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "50%": { transform: "rotate(-12deg)" },
        },
        "wing-flap-right-fast": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "50%": { transform: "rotate(12deg)" },
        },
        "wing-tuck-left": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(20deg) translateY(5px)" },
        },
        "wing-tuck-right": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(-20deg) translateY(5px)" },
        },
        "kiting-body-dive": {
          "0%": { transform: "translateY(0) rotate(0deg)" },
          "100%": { transform: "translateY(6px) rotate(25deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "shimmer": "shimmer 2s linear infinite",
        // Kiting Mode Animations
        "kiting-hover": "kiting-hover 3s ease-in-out infinite",
        "kiting-scan": "kiting-scan 1.5s ease-in-out infinite",
        "kiting-dive": "kiting-dive 0.6s ease-out forwards",
        "kiting-strike": "kiting-strike 0.5s ease-out",
        "kiting-flash": "kiting-flash 0.4s ease-out forwards",
        "kiting-radar": "kiting-radar 2s linear infinite",
        // Wing Mark animations
        "wing-left": "wing-left 2.5s ease-in-out infinite",
        "wing-right": "wing-right 2.5s ease-in-out infinite",
        "wing-left-fast": "wing-left-fast 1s ease-in-out infinite",
        "wing-right-fast": "wing-right-fast 1s ease-in-out infinite",
        "wing-dive-left": "wing-dive-left 0.4s ease-out forwards",
        "wing-dive-right": "wing-dive-right 0.4s ease-out forwards",
        "wing-strike": "wing-strike 0.5s ease-out",
        "tail-dive": "tail-dive 0.4s ease-out forwards",
        "tail-strike": "tail-strike 0.5s ease-out",
        // Legacy wing animations
        "wing-flap-left": "wing-flap-left 2s ease-in-out infinite",
        "wing-flap-right": "wing-flap-right 2s ease-in-out infinite",
        "wing-flap-left-fast": "wing-flap-left-fast 0.8s ease-in-out infinite",
        "wing-flap-right-fast": "wing-flap-right-fast 0.8s ease-in-out infinite",
        "wing-tuck-left": "wing-tuck-left 0.3s ease-out forwards",
        "wing-tuck-right": "wing-tuck-right 0.3s ease-out forwards",
        "kiting-body-dive": "kiting-body-dive 0.4s ease-out forwards",
      },
      boxShadow: {
        glow: "0 0 30px hsl(var(--primary) / 0.15)",
        card: "0 4px 20px hsl(0 0% 0% / 0.4)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
