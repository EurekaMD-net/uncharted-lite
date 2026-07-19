/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F1EEE4",
        "paper-2": "#FBFAF5",
        ink: "#1B211C",
        "ink-soft": "#586159",
        jade: "#1F6B4F",
        "jade-bright": "#2E9B6E",
        amber: "#C98A1E",
        brick: "#A6383C",
        line: "#DED9CB",
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "sans-serif"],
        body: ["Figtree", "system-ui", "sans-serif"],
        mono: ["'Space Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
