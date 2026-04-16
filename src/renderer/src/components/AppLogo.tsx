export function AppLogo() {
  const s = 28
  const lr = s * 0.25
  const sw = Math.max(2, s * 0.1)
  const ang = (30 * Math.PI) / 180
  const dist = (lr * (1.618 - 0.4)) / 2
  const dx = dist * Math.cos(ang)
  const dy = dist * Math.sin(ang)
  const lx = s * 0.5 - dx
  const ly = s * 0.5 + dy
  const rx = s * 0.5 + dx
  const ry = s * 0.5 - dy

  return (
    <svg
      className="logo-mark"
      viewBox={`0 0 ${s} ${s}`}
      width={s}
      height={s}
      aria-hidden="true"
      focusable="false"
    >
      <rect width={s} height={s} rx={s * 0.3} fill="#FF0000" />
      <circle cx={lx} cy={ly} r={lr} fill="none" stroke="#fff" strokeWidth={sw} />
      <circle cx={rx} cy={ry} r={lr} fill="none" stroke="#fff" strokeWidth={sw} />
      <line
        x1={s * 0.18} y1={s * 0.82} x2={s * 0.82} y2={s * 0.18}
        stroke="rgba(255,255,255,0.7)" strokeWidth={Math.max(1, s * 0.02)} strokeLinecap="round"
      />
    </svg>
  )
}
