import React from "react";

const MARKS = [
  { top: "6%", left: "4%", size: 200, rotate: -18, opacity: 0.09, delay: 0 },
  { top: "14%", right: "6%", size: 260, rotate: 12, opacity: 0.08, delay: -4 },
  { top: "38%", left: "-2%", size: 320, rotate: -8, opacity: 0.06, delay: -8 },
  { top: "52%", right: "2%", size: 240, rotate: 22, opacity: 0.08, delay: -12 },
  { bottom: "12%", left: "10%", size: 280, rotate: 6, opacity: 0.07, delay: -2 },
  { bottom: "8%", right: "12%", size: 220, rotate: -14, opacity: 0.08, delay: -6 },
  { top: "22%", left: "42%", size: 140, rotate: 0, opacity: 0.045, delay: -10 },
  { top: "68%", left: "55%", size: 180, rotate: -6, opacity: 0.055, delay: -14 },
];

export function PlatformScBackground() {
  return (
    <div className="platScBg" aria-hidden>
      <div className="platScBg__veil" />
      {MARKS.map((m, i) => (
        <span
          key={i}
          className="platScBg__mark"
          style={{
            top: m.top,
            left: m.left,
            right: m.right,
            bottom: m.bottom,
            width: m.size,
            height: m.size,
            "--sc-rotate": `${m.rotate}deg`,
            "--sc-opacity": m.opacity,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
