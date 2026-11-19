const COLORS = { Delivered: "#4c8064", Shipped: "#6750a4", "Out for Delivery": "#66899b", Processing: "#b78232", Cancelled: "#9a7785", "Ready for Pickup": "#8d79c4" };

export default function InteractiveDonutChart({ data = [], total = 0 }) {
  const actualTotal = data.reduce((sum, item) => sum + Number(item.count || 0), 0);
  let cursor = 0;
  const segments = data.map((item) => {
    const start = cursor;
    cursor += actualTotal ? (Number(item.count || 0) / actualTotal) * 100 : 0;
    return `${COLORS[item.status] || "#94a3b8"} ${start}% ${cursor}%`;
  });
  const gradient = segments.length ? `conic-gradient(${segments.join(", ")})` : "#e2e8f0";
  return <div className="dashboard-panel">
    <div className="panel-header"><div><h3 style={{ fontSize: "16px", fontWeight: 700 }}>Order Fulfillment</h3><p style={{ fontSize: "12px", color: "#64748b" }}>Current order status distribution</p></div></div>
    <div style={{ display: "flex", alignItems: "center", gap: "24px", marginTop: "12px", flexWrap: "wrap" }}>
      <div style={{ width: "130px", height: "130px", borderRadius: "50%", background: gradient, display: "grid", placeItems: "center", flexShrink: 0 }}><div style={{ width: "84px", height: "84px", borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><strong style={{ fontSize: "18px" }}>{total}</strong><span style={{ fontSize: "11px", color: "#64748b" }}>Orders</span></div></div>
      {data.length === 0 ? <p style={{ color: "#64748b", fontSize: "13px" }}>Status breakdown will appear when orders exist.</p> : <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>{data.map((item) => <div key={item.status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", fontSize: "12px" }}><span style={{ display: "flex", alignItems: "center", gap: "8px" }}><i style={{ width: "9px", height: "9px", borderRadius: "50%", background: COLORS[item.status] || "#94a3b8" }} />{item.status}</span><strong>{item.count} ({actualTotal ? Math.round(item.count * 100 / actualTotal) : 0}%)</strong></div>)}</div>}
    </div>
  </div>;
}
