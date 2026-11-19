import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { DollarSign, ShoppingBag, Store, Truck, ShieldAlert, Award, FileText, RefreshCw, Search, Clock3 } from "lucide-react";
import StatCard from "../../components/admin/StatCard";
import SalesRevenueChart from "../../components/admin/SalesRevenueChart";
import InteractiveBarChart from "../../components/admin/InteractiveBarChart";
import InteractiveDonutChart from "../../components/admin/InteractiveDonutChart";
import QuickActionsPanel from "../../components/admin/QuickActionsPanel";
import FulfillmentSnapshot from "../../components/admin/FulfillmentSnapshot";

const API = "http://127.0.0.1:8000";
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("All statuses");
  const [dashboardSection, setDashboardSection] = useState("overview");

  const loadStats = useCallback(async () => {
    try {
      const [res, logsRes] = await Promise.all([
        axios.get(`${API}/admin/dashboard/stats`),
        axios.get(`${API}/admin/dashboard/audit-logs`),
      ]);
      setStats(res.data);
      setAuditLogs(logsRes.data || []);
      setError("");
    } catch (loadError) {
      console.error("Failed loading admin dashboard:", loadError);
      setError("Dashboard data is unavailable. Check the API connection.");
    }
  }, []);

  useEffect(() => {
    loadStats();
    const poll = window.setInterval(loadStats, 7000);
    return () => window.clearInterval(poll);
  }, [loadStats]);

  useEffect(() => {
    const tick = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const data = stats || {};
  const orderStatuses = useMemo(() => ["All statuses", ...new Set((data.recent_orders || []).map((order) => order.status).filter(Boolean))], [data.recent_orders]);
  const visibleOrders = useMemo(() => (data.recent_orders || []).filter((order) => {
    const query = orderSearch.trim().toLowerCase();
    const matchesSearch = !query || `${order.id} ${order.customer || ""} ${order.vendor || ""}`.toLowerCase().includes(query);
    return matchesSearch && (orderStatus === "All statuses" || order.status === orderStatus);
  }), [data.recent_orders, orderSearch, orderStatus]);
  const kpis = [
    { title: "Total GMV", value: money(data.total_gmv || data.total_revenue), icon: DollarSign, to: "/admin/orders" },
    { title: "Platform Commission", value: money(data.platform_commission), icon: Award, to: "/admin/vendors" },
    { title: "Total Orders", value: data.total_orders ?? "—", icon: ShoppingBag, to: "/admin/orders" },
    { title: "Active Vendors", value: data.active_vendors ?? "—", icon: Store, to: "/admin/vendors" },
    { title: "Pending Products", value: data.pending_products ?? "0", icon: ShieldAlert, to: "/admin/products" },
    { title: "Delivery Fleet", value: data.active_riders ?? "—", icon: Truck, to: "/admin/delivery" },
  ];
  const jumpTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="admin-dashboard-page" id="dashboard-overview">
      <section className="admin-dashboard-hero">
        <div className="admin-dashboard-hero-copy">
          <span className="admin-dashboard-eyebrow">YOUR MARKETPLACE, AT A GLANCE</span>
          <h1>Dashboard Overview</h1>
          <p>Track orders, sellers, and delivery operations from one place.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="admin-dashboard-clock" aria-label={`Current time ${currentTime.toLocaleTimeString()}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 15px", border: "1px solid #d9cdee", borderRadius: 999, background: "rgba(255,255,255,.86)", color: "#40315f", fontSize: 16, fontWeight: 750, fontVariantNumeric: "tabular-nums", boxShadow: "0 3px 10px rgba(61,44,91,.08)" }}><Clock3 size={19} strokeWidth={2.4} />{currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          <button type="button" onClick={loadStats} title="Refresh dashboard" style={{ border: "1px solid #dbe3ef", background: "white", borderRadius: 8, padding: 8, display: "inline-flex", color: "#334155", cursor: "pointer" }}><RefreshCw size={15} /></button>
          <span style={{ background: error ? "#fee2e2" : "#dcfce7", color: error ? "#b91c1c" : "#166534", padding: "6px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 }}>
            {error ? "● API Offline" : stats ? "● Live" : "● Loading"}
          </span>
        </div>
      </section>
      <nav className="admin-dashboard-nav" aria-label="Dashboard sections">
        <button type="button" aria-current={dashboardSection === "overview" ? "page" : undefined} className={dashboardSection === "overview" ? "is-active" : ""} onClick={() => { setDashboardSection("overview"); jumpTo("dashboard-overview"); }}>Overview</button>
        <button type="button" aria-current={dashboardSection === "operations" ? "page" : undefined} className={dashboardSection === "operations" ? "is-active" : ""} onClick={() => { setDashboardSection("operations"); jumpTo("dashboard-operations"); }}>Operations</button>
        <button type="button" aria-current={dashboardSection === "trends" ? "page" : undefined} className={dashboardSection === "trends" ? "is-active" : ""} onClick={() => { setDashboardSection("trends"); jumpTo("dashboard-trends"); }}>Trends</button>
        <button type="button" aria-current={dashboardSection === "activity" ? "page" : undefined} className={dashboardSection === "activity" ? "is-active" : ""} onClick={() => { setDashboardSection("activity"); jumpTo("dashboard-activity"); }}>Activity</button>
      </nav>
      {error && <p role="alert" style={{ color: "#b91c1c", fontSize: "13px" }}>{error}</p>}

      {/* Primary KPI Grid */}
      <div className="stats-grid admin-dashboard-kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 16 }}>
        {kpis.map(({ title, value, icon, to }) => <StatCard key={title} title={title} value={value} icon={icon} onClick={() => navigate(to)} />)}
      </div>

      <div className="admin-dashboard-tools" id="dashboard-operations">
        <QuickActionsPanel stats={data} onNavigate={navigate} />
        <FulfillmentSnapshot breakdown={data.order_breakdown || []} total={data.total_orders || 0} />
      </div>

      <div className="charts-grid" id="dashboard-trends">
        <SalesRevenueChart data={data.monthly_revenue || []} />
        <InteractiveBarChart data={data.category_sales || []} />
      </div>

      <div className="bottom-grid" id="dashboard-activity">
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <InteractiveDonutChart data={data.order_breakdown || []} total={data.total_orders || 0} />
          <div className="dashboard-panel">
            <div className="panel-header"><h3 style={{ fontSize: "16px", fontWeight: 700 }}>Top Vendors by Sales</h3></div>
            {(data.top_vendors || []).length === 0 ? <p style={{ color: "#64748b", fontSize: "13px" }}>No vendor sales yet.</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {data.top_vendors.map((vendor) => (
                  <div key={vendor.id || vendor.name} style={{ display: "flex", justifyContent: "space-between", gap: "12px", paddingBottom: "10px", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{vendor.name}</div>
                      <div style={{ color: "#64748b", fontSize: "12px" }}>{vendor.products} products · Commission: {money(vendor.commission)}</div>
                    </div>
                    <strong>{money(vendor.revenue)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="panel-header">
            <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Recent Marketplace Orders</h3>
            <button type="button" onClick={() => navigate("/admin/orders")} style={{ border: 0, background: "transparent", color: "#6d28d9", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>All orders →</button>
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>
            <label style={{ position: "relative", flex: "1 1 180px" }}><Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#94a3b8" }} /><input aria-label="Search recent orders" placeholder="Search order, customer, vendor" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} style={{ width: "100%", padding: "8px 10px 8px 31px", border: "1px solid #dbe3ef", borderRadius: 8, fontSize: 12 }} /></label>
            <select aria-label="Filter orders by status" value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)} style={{ padding: "8px 10px", border: "1px solid #dbe3ef", borderRadius: 8, background: "white", fontSize: 12 }}>{orderStatuses.map((status) => <option key={status}>{status}</option>)}</select>
            <span style={{ alignSelf: "center", color: "#64748b", fontSize: 11 }}>{visibleOrders.length} shown</span>
          </div>
          {visibleOrders.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: "13px" }}>{(data.recent_orders || []).length ? "No orders match your search and status filters." : "No orders have been placed."}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Vendor</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order) => (
                    <tr key={order.id} className={selectedOrder?.raw_id === order.raw_id ? "admin-dashboard-order-selected" : ""} onClick={() => setSelectedOrder(order)} style={{ cursor: "pointer" }}>
                      <td style={{ fontWeight: 600, color: "#2563eb" }}>{order.id}</td>
                      <td>{order.customer}</td>
                      <td>{order.vendor || "—"}</td>
                      <td style={{ fontWeight: 600 }}>{money(order.total)}</td>
                      <td>
                        <span className={`status-pill status-${String(order.status).toLowerCase().replaceAll(" ", "-")}`}>
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selectedOrder && <div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px solid #e2e8f0" }}>
            <h4 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "10px" }}>Order timeline · {selectedOrder.id}</h4>
            {(selectedOrder.timeline || []).length ? <div style={{ display: "grid", gap: "9px" }}>{selectedOrder.timeline.map((event, index) => <div key={`${event.status}-${index}`} style={{ display: "grid", gridTemplateColumns: "135px 1fr", gap: "10px", fontSize: "12px" }}><strong>{event.status}</strong><span>{event.note || event.actor_role} · {event.created_at ? new Date(event.created_at).toLocaleString() : ""}</span></div>)}</div> : <p style={{ color: "#64748b", fontSize: "12px" }}>No timeline events recorded.</p>}
          </div>}
        </div>
      </div>

      {/* Live audit logs */}
      <div className="dashboard-panel admin-dashboard-audit" id="dashboard-audit" style={{ marginTop: "24px" }}>
        <div className="panel-header" style={{ marginBottom: "16px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
            <FileText size={18} color="#2563eb" /> Real-Time Governance & Audit Logs (`audit_logs`)
          </h3>
          <span style={{ fontSize: "12px", color: "#64748b" }}>Latest 25 system actions</span>
        </div>
        {auditLogs.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: "13px" }}>No audit log entries recorded yet. Actions such as product approvals, vendor status changes, and settings updates will record here.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Log ID</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target Entity</th>
                  <th>Entity ID</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontWeight: 600, color: "#64748b" }}>#{log.id}</td>
                    <td><strong>{log.actor}</strong> ({log.actor_role})</td>
                    <td><span style={{ background: "#f1f5f9", padding: "3px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600 }}>{log.action}</span></td>
                    <td>{log.entity_type}</td>
                    <td>{log.entity_id ?? "—"}</td>
                    <td style={{ fontSize: "12px", color: "#64748b" }}>{log.created_at ? new Date(log.created_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
