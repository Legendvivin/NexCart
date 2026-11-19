const STATUS_COLORS = {
  Processing: "#f59e0b",
  "Ready for Pickup": "#8b5cf6",
  Shipped: "#2563eb",
  "Out for Delivery": "#0ea5e9",
  Delivered: "#10b981",
  Cancelled: "#94a3b8",
};

export default function FulfillmentSnapshot({ breakdown = [], total = 0 }) {
  const rows = [...breakdown].sort((a, b) => Number(b.count) - Number(a.count));
  return (
    <section className="dashboard-panel">
      <div className="panel-header">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Fulfillment Snapshot</h2>
          <p style={{ marginTop: 3, color: "#64748b", fontSize: 12 }}>Order status across the marketplace.</p>
        </div>
        <strong style={{ color: "#0f172a", fontSize: 18 }}>{Number(total).toLocaleString("en-IN")}</strong>
      </div>
      {rows.length === 0 ? <p style={{ color: "#64748b", fontSize: 13 }}>Order status data will appear here.</p> : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map(({ status, count }) => {
            const value = Number(count) || 0;
            const share = total ? Math.round(value * 100 / total) : 0;
            const color = STATUS_COLORS[status] || "#64748b";
            return <div key={status}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: "#334155", fontWeight: 600 }}>{status}</span>
                <span style={{ color: "#64748b" }}>{value} · {share}%</span>
              </div>
              <div aria-label={`${status}: ${share}%`} role="img" style={{ height: 7, borderRadius: 999, background: "#eef2f7", overflow: "hidden" }}>
                <div style={{ width: `${share}%`, height: "100%", borderRadius: 999, background: color, transition: "width 250ms ease" }} />
              </div>
            </div>;
          })}
        </div>
      )}
    </section>
  );
}
