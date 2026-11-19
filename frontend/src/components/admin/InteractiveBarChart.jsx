import { useState } from "react";

const COLORS = ["#6750a4", "#8d79c4", "#ad9bd9", "#b4cdbb", "#d0dfd2"];

export default function InteractiveBarChart({ data = [] }) {
  const [selected, setSelected] = useState("");
  const maxSales = Math.max(1, ...data.map((item) => Number(item.sales || 0)));
  return <div className="dashboard-panel">
    <div className="panel-header"><div><h3 style={{ fontSize: "16px", fontWeight: 700 }}>Sales by Category</h3><p style={{ fontSize: "12px", color: "#64748b" }}>Product sales from completed marketplace orders</p></div></div>
    {data.length === 0 ? <p style={{ color: "#64748b", fontSize: "13px" }}>Category sales will appear after orders are placed.</p> : <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "10px" }}>
      {data.map((item, index) => { const width = Math.round((Number(item.sales || 0) / maxSales) * 100); const active = selected ? selected === item.label : index === 0; return <button key={item.label} type="button" onClick={() => setSelected(item.label)} style={{ padding: 0, border: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px", marginBottom: "5px", fontWeight: active ? 700 : 500 }}><span>{item.label}</span><span>₹{Number(item.sales).toLocaleString("en-IN")}</span></span>
        <span className="admin-category-track" style={{ display: "block", height: "10px", borderRadius: "999px", overflow: "hidden", background: "#f1eef5" }}><span style={{ display: "block", width: `${width}%`, height: "100%", background: active ? "#6750a4" : COLORS[index % COLORS.length], borderRadius: "999px", transition: "width 350ms cubic-bezier(.2,.8,.2,1.2)" }} /></span>
      </button>; })}
    </div>}
  </div>;
}
