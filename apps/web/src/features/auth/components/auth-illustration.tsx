/**
 * Decorative vector for the sign-in panel. Inline SVG rather than an asset so
 * it inherits theme tokens and costs no extra request; `currentColor` and the
 * chart tokens mean it recolours with light/dark automatically.
 *
 * It depicts what the product is: people records, an attendance calendar and
 * a trend line — not generic abstract shapes.
 */
export function AuthIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 340"
      fill="none"
      role="img"
      aria-label="Illustration of an HR dashboard showing a team directory, attendance calendar and headcount trend"
      className={className}
    >
      <title>HRMS dashboard illustration</title>

      {/* soft ground */}
      <ellipse cx="210" cy="316" rx="150" ry="14" fill="currentColor" opacity="0.06" />

      {/* ── back card: headcount trend ── */}
      <g opacity="0.95">
        <rect x="196" y="34" width="196" height="126" rx="14" fill="var(--card)" />
        <rect
          x="196"
          y="34"
          width="196"
          height="126"
          rx="14"
          stroke="currentColor"
          strokeOpacity="0.14"
        />
        <rect x="214" y="54" width="66" height="7" rx="3.5" fill="currentColor" opacity="0.28" />
        <rect x="214" y="68" width="40" height="6" rx="3" fill="currentColor" opacity="0.16" />
        {/* trend */}
        <path
          d="M214 134 L246 116 L278 122 L310 96 L342 104 L374 78"
          stroke="var(--chart-1)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="374" cy="78" r="4.5" fill="var(--chart-1)" />
        <path
          d="M214 134 L246 116 L278 122 L310 96 L342 104 L374 78 L374 146 L214 146 Z"
          fill="var(--chart-1)"
          opacity="0.1"
        />
      </g>

      {/* ── attendance calendar ── */}
      <g>
        <rect x="28" y="96" width="168" height="150" rx="14" fill="var(--card)" />
        <rect
          x="28"
          y="96"
          width="168"
          height="150"
          rx="14"
          stroke="currentColor"
          strokeOpacity="0.14"
        />
        <rect x="46" y="116" width="52" height="7" rx="3.5" fill="currentColor" opacity="0.28" />
        {/* day grid — a week of statuses, using the same series colours as the app */}
        {[0, 1, 2, 3, 4].map((col) =>
          [0, 1, 2, 3].map((row) => {
            const i = row * 5 + col;
            const fill =
              i === 6 || i === 12
                ? 'var(--chart-3)'
                : i === 8
                  ? 'var(--chart-5)'
                  : i % 7 === 3
                    ? 'var(--chart-2)'
                    : 'currentColor';
            const opacity = fill === 'currentColor' ? 0.1 : 0.85;
            return (
              <rect
                key={`${col}-${row}`}
                x={46 + col * 26}
                y={138 + row * 24}
                width="18"
                height="18"
                rx="5"
                fill={fill}
                opacity={opacity}
              />
            );
          }),
        )}
      </g>

      {/* ── front card: team directory ── */}
      <g>
        <rect x="112" y="180" width="204" height="112" rx="14" fill="var(--card)" />
        <rect
          x="112"
          y="180"
          width="204"
          height="112"
          rx="14"
          stroke="currentColor"
          strokeOpacity="0.14"
        />
        {[0, 1, 2].map((row) => (
          <g key={row} transform={`translate(0 ${row * 30})`}>
            <circle cx="142" cy="212" r="11" fill={`var(--chart-${row + 1})`} opacity="0.9" />
            <rect
              x="162"
              y="205"
              width={[86, 68, 78][row]}
              height="7"
              rx="3.5"
              fill="currentColor"
              opacity="0.26"
            />
            <rect
              x="162"
              y="217"
              width={[52, 44, 60][row]}
              height="6"
              rx="3"
              fill="currentColor"
              opacity="0.13"
            />
            <rect
              x="276"
              y="206"
              width="26"
              height="12"
              rx="6"
              fill={`var(--chart-${row + 1})`}
              opacity="0.18"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
