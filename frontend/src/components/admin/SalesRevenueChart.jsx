import { useState } from "react";

export default function SalesRevenueChart({ data = [] }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const maxVal = Math.max(1, ...data.map((item) => Number(item.revenue || 0)));
  const width = 520;
  const height = 200;
  const padding = 28;
  const points = data.map((item, idx) => ({
    ...item,
    x: data.length < 2 ? width / 2 : padding + (idx * (width - padding * 2)) / (data.length - 1),
    y: height - padding - (Number(item.revenue || 0) / maxVal) * (height - padding * 2),
  }));
  const active = points[hoveredIndex ?? points.length - 1];

  return <div className="dashboard-panel">
    <div className="panel-header"><div><h3 style={{ fontSize: "16px", fontWeight: 700 }}>Revenue Trend</h3><p style={{ fontSize: "12px", color: "#64748b" }}>Monthly totals from completed, non-cancelled orders</p></div>
      {active && <div style={{ textAlign: "right" }}><strong style={{ fontSize: "18px", color: "#2563eb" }}>₹{Number(active.revenue).toLocaleString("en-IN")}</strong><div style={{ fontSize: "12px", color: "#64748b" }}>{active.month} · {active.orders} orders</div></div>}
    </div>
    {points.length === 0 ? <p style={{ color: "#64748b", fontSize: "13px" }}>Revenue data will appear after orders are placed.</p> : <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "210px", overflow: "visible" }}>
      {[0, .5, 1].map((ratio) => { const y = padding + ratio * (height - padding * 2); return <line key={ratio} x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e8e2f1" strokeDasharray="4 5" />; })}
      <polyline fill="none" stroke="#6750a4" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
      {points.map((point, index) => <g key={`${point.month}-${index}`} style={{ cursor: "pointer" }} onMouseEnter={() => setHoveredIndex(index)} onFocus={() => setHoveredIndex(index)} tabIndex={0} role="button" aria-label={`${point.month}: ${point.revenue}`}><circle cx={point.x} cy={point.y} r={hoveredIndex === index ? 7 : 4.5} fill={hoveredIndex === index ? "#6750a4" : "#fff"} stroke="#6750a4" strokeWidth="2.5" /><text x={point.x} y={height - 4} textAnchor="middle" fontSize="12" fill="#625d70">{point.month}</text></g>)}
    </svg>}
  </div>;
}
