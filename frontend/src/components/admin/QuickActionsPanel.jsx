import { ArrowRight, ClipboardList, PackageCheck, Store, Truck } from "lucide-react";

const actions = [
  { label: "Review pending products", key: "pending_products", route: "/admin/products", icon: PackageCheck, color: "#7c3aed" },
  { label: "Manage orders", key: "total_orders", route: "/admin/orders", icon: ClipboardList, color: "#2563eb" },
  { label: "Review vendors", key: "active_vendors", route: "/admin/vendors", icon: Store, color: "#059669" },
  { label: "Assign delivery drivers", key: "active_riders", route: "/admin/delivery", icon: Truck, color: "#d97706" },
];

export default function QuickActionsPanel({ stats, onNavigate }) {
  return (
    <section className="dashboard-panel">
      <div className="panel-header">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Quick Actions</h2>
          <p style={{ marginTop: 3, color: "#64748b", fontSize: 12 }}>Jump to the work that needs attention.</p>
        </div>
      </div>
      <div className="admin-quick-actions">
        {actions.map(({ label, key, route, icon: Icon, color }) => (
          <button key={key} type="button" onClick={() => onNavigate(route)} className="admin-quick-action">
            <span className="admin-quick-action-icon" style={{ color, background: `${color}12` }}><Icon size={18} /></span>
            <span className="admin-quick-action-copy"><strong>{label}</strong><small>{Number(stats?.[key] || 0).toLocaleString("en-IN")} currently</small></span>
            <ArrowRight size={16} color="#94a3b8" />
          </button>
        ))}
      </div>
    </section>
  );
}
