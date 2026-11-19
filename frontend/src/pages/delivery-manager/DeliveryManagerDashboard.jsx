
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import NotificationCenter from "../../components/common/NotificationCenter";
import {
  Truck,
  PackageCheck,
  MapPin,
  LogOut,
  Clock,
  Navigation,
  Search,
  RefreshCw,
  CheckCircle2,
  Package,
  BarChart3,
  Users,
  Phone,
  ShieldCheck,
  Map,
  IndianRupee,
  AlertCircle,
} from "lucide-react";

const STAGES = ["Ready for Pickup", "Shipped", "Out for Delivery", "Delivered"];

export default function DeliveryDashboard() {
  const navigate = useNavigate();
  const managerName = localStorage.getItem("nexcart_delivery_name") || "Delivery Operations";
  const deliveryToken = localStorage.getItem("nexcart_delivery_token");

  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState("dispatch");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [chartView, setChartView] = useState("week");

  // Interactive Rider Assignment & OTP Verification per Order
  const [fleetRiders, setFleetRiders] = useState([]);
  const [incidents, setIncidents] = useState([]);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  };

  const fetchDeliveries = async () => {
    setLoading(true);
    try {
      const res = await axios.get("http://127.0.0.1:8000/delivery/orders", { headers: { Authorization: `Bearer ${deliveryToken}` } });
      const [ridersRes, incidentsRes] = await Promise.all([
        axios.get("http://127.0.0.1:8000/delivery/riders"),
        axios.get("http://127.0.0.1:8000/delivery/incidents"),
      ]);
      setOrders(res.data);
      setFleetRiders(ridersRes.data);
      setIncidents(incidentsRes.data);
    } catch (err) {
      console.error("Failed loading deliveries:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
    const poll = window.setInterval(fetchDeliveries, 7000);
    return () => window.clearInterval(poll);
  }, []);

  const handleAssignRider = async (orderId, riderId) => {
    try {
      await axios.patch(`http://127.0.0.1:8000/delivery/orders/${orderId}/assign`, { rider_id: riderId ? Number(riderId) : null }, { headers: { Authorization: `Bearer ${deliveryToken}` } });
      notify(riderId ? "Rider assignment saved." : "Rider assignment removed.");
      fetchDeliveries();
    } catch (err) {
      notify(err.response?.data?.detail || "Could not update rider assignment.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("nexcart_delivery_token");
    localStorage.removeItem("nexcart_delivery_name");
    navigate("/delivery/login");
  };

  // Metrics
  const readyForPickupCount = orders.filter((o) => o.status === "Ready for Pickup").length;
  const inTransitCount = orders.filter((o) => o.status === "Shipped" || o.status === "Out for Delivery").length;
  const deliveredCount = orders.filter((o) => o.status === "Delivered").length;
  const totalDispatchValue = orders.reduce((sum, o) => sum + o.total_amount, 0);

  // Filtered Orders
  const filteredOrders = orders.filter((o) => {
    const matchesStatus = statusFilter === "All" || o.status === statusFilter;
    const matchesSearch =
      o.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.shipping_address.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case "Delivered":
        return { bg: "#dcfce7", color: "#15803d", border: "#86efac" };
      case "Out for Delivery":
        return { bg: "#dbeafe", color: "#1d4ed8", border: "#93c5fd" };
      case "Shipped":
        return { bg: "#f3e8ff", color: "#7e22ce", border: "#d8b4fe" };
      default:
        return { bg: "#fef3c7", color: "#b45309", border: "#fde68a" };
    }
  };

  const navItems = [
    { id: "dispatch", label: "Live Dispatch Board", icon: Navigation },
    { id: "routes", label: "Route Corridors & Live Map", icon: Map },
    { id: "fleet", label: "Delivery Fleet & Riders", icon: Users },
    { id: "cod", label: "COD & Rider Settlement", icon: IndianRupee },
    { id: "analytics", label: "Delivery Analytics", icon: BarChart3 },
  ];

  const codOrders = orders.filter((order) => order.payment_method === "COD");
  const codOutstanding = codOrders.filter((order) => !order.cod_collected && order.status !== "Cancelled").reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const codReceived = codOrders.filter((order) => order.cod_collected).reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const completedByDate = (chartView) => {
    const days = chartView === "week" ? 7 : 30;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);
    const values = Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const count = orders.filter((order) => order.delivered_at && new Date(order.delivered_at).toDateString() === date.toDateString()).length;
      return { label: date.toLocaleDateString("en-IN", { day: "numeric", month: days === 7 ? "short" : undefined }), drops: count };
    });
    const max = Math.max(1, ...values.map((value) => value.drops));
    return values.map((value) => ({ ...value, pct: value.drops / max * 100 }));
  };
  const slaBars = completedByDate(chartView);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Inter', system-ui, sans-serif", color: "#0f172a" }}>
      {/* Floating Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#0f172a",
            color: "#fff",
            padding: "13px 20px",
            borderRadius: "12px",
            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.25)",
            zIndex: 100,
            fontSize: "14px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            borderLeft: "4px solid #f59e0b",
          }}
        >
          <CheckCircle2 size={18} color="#f59e0b" />
          {toast}
        </div>
      )}

      {/* Left Sidebar (6 Modules) */}
      <aside
        style={{
          width: "265px",
          background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          padding: "24px 16px",
          boxShadow: "4px 0 20px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 10px 22px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ background: "rgba(245, 158, 11, 0.15)", padding: "10px", borderRadius: "12px", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
            <Truck size={24} color="#f59e0b" />
          </div>
          <div>
            <h2 style={{ fontSize: "17px", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>NexCart Express</h2>
            <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 500 }}>Logistics Control Hub</span>
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "20px", flex: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "11px 14px",
                  borderRadius: "10px",
                  border: "none",
                  background: isActive ? "#f59e0b" : "transparent",
                  color: isActive ? "#0f172a" : "#cbd5e1",
                  fontWeight: isActive ? 700 : 600,
                  fontSize: "13.5px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.2s ease",
                }}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div style={{ background: "rgba(255,255,255,0.05)", padding: "14px", borderRadius: "10px", marginBottom: "14px", fontSize: "12px" }}>
          <div style={{ color: "#94a3b8", marginBottom: "4px" }}>Logged in Dispatcher</div>
          <div style={{ fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "6px" }}>
            <ShieldCheck size={15} color="#10b981" /> {managerName}
          </div>
        </div>

        <button
          onClick={handleLogout}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            background: "#ef4444",
            color: "#fff",
            border: "none",
            padding: "11px",
            borderRadius: "10px",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: "14px",
          }}
        >
          <LogOut size={16} /> Sign Out
        </button>
      </aside>

      {/* Main Workspace */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            background: "#fff",
            padding: "18px 32px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1 style={{ fontSize: "21px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
              {navItems.find((n) => n.id === activeTab)?.label}
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#64748b" }}>
              Real-time order fulfillment synced across Customer, Vendor & Admin portals
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <NotificationCenter role="delivery" />
          <button
            onClick={fetchDeliveries}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "#f8fafc",
              color: "#0f172a",
              border: "1px solid #cbd5e1",
              padding: "9px 16px",
              borderRadius: "10px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={15} />
            {loading ? "Syncing..." : "Refresh Queue"}
          </button>
          </div>
        </header>

        <main style={{ padding: "28px 32px", maxWidth: "1280px", width: "100%" }}>
          {/* 4 Logistics KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "28px" }}>
            <button type="button" onClick={() => { setActiveTab("dispatch"); setStatusFilter("Ready for Pickup"); }} aria-pressed={activeTab === "dispatch" && statusFilter === "Ready for Pickup"} style={{ textAlign: "left", cursor: "pointer", background: "#fff", padding: "20px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "none", borderTop: "4px solid #f59e0b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: 600 }}>
                <span>Ready for Pickup</span>
                <Clock size={18} color="#f59e0b" />
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0f172a", marginTop: "8px" }}>{readyForPickupCount}</div>
              <span style={{ fontSize: "12px", color: "#b45309", fontWeight: 500 }}>Packed and waiting for driver pickup</span>
            </button>

            <div style={{ background: "#fff", padding: "20px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderTop: "4px solid #3b82f6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: 600 }}>
                <span>In-Transit / Out</span>
                <Truck size={18} color="#3b82f6" />
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0f172a", marginTop: "8px" }}>{inTransitCount}</div>
              <span style={{ fontSize: "12px", color: "#2563eb", fontWeight: 500 }}>Currently on delivery routes</span>
            </div>

            <div style={{ background: "#fff", padding: "20px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderTop: "4px solid #10b981" }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: 600 }}>
                <span>Delivered Orders</span>
                <PackageCheck size={18} color="#10b981" />
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#10b981", marginTop: "8px" }}>{deliveredCount}</div>
              <span style={{ fontSize: "12px", color: "#15803d", fontWeight: 500 }}>Successfully handed over</span>
            </div>

            <div style={{ background: "#fff", padding: "20px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderTop: "4px solid #8b5cf6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: 600 }}>
                <span>Cargo Value</span>
                <Package size={18} color="#8b5cf6" />
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0f172a", marginTop: "8px" }}>
                ₹{totalDispatchValue.toLocaleString("en-IN")}
              </div>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 500 }}>Total insured shipment value</span>
            </div>
          </div>

          {/* 1. LIVE DISPATCH BOARD */}
          {activeTab === "dispatch" && (
            <div>
              <div
                style={{
                  background: "#fff",
                  padding: "16px 20px",
                  borderRadius: "14px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                  marginBottom: "20px",
                }}
              >
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {["All", ...STAGES].map((st) => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        border: "none",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        background: statusFilter === st ? "#0f172a" : "#f1f5f9",
                        color: statusFilter === st ? "#fff" : "#475569",
                      }}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                <div style={{ position: "relative", minWidth: "280px" }}>
                  <Search size={16} style={{ position: "absolute", left: "12px", top: "11px", color: "#94a3b8" }} />
                  <input
                    type="text"
                    placeholder="Search order ID, customer, or address..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 12px 9px 36px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              {filteredOrders.length === 0 ? (
                <div style={{ background: "#fff", padding: "48px 24px", borderRadius: "14px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                  <Truck size={42} color="#cbd5e1" style={{ marginBottom: "12px" }} />
                  <h3 style={{ margin: "0 0 6px", fontSize: "17px", fontWeight: 700 }}>No Shipments Found</h3>
                  <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>
                    Place an order on the Customer Storefront (port 5173) or click <strong>All</strong> to view active dispatches.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {filteredOrders.map((order) => {
                    const currentStepIdx = STAGES.indexOf(order.status);
                    const badge = getStatusBadge(order.status);
                    const assignedRider = order.assigned_rider || "Unassigned";

                    return (
                      <div
                        key={order.id}
                        style={{
                          background: "#fff",
                          borderRadius: "14px",
                          padding: "22px 24px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "14px", marginBottom: "18px" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                              <span style={{ fontSize: "17px", fontWeight: 800, color: "#0f172a" }}>{order.order_number}</span>
                              <span
                                style={{
                                  padding: "4px 12px",
                                  borderRadius: "999px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  background: badge.bg,
                                  color: badge.color,
                                  border: `1px solid ${badge.border}`,
                                }}
                              >
                                {order.status}
                              </span>
                              <span style={{ fontSize: "12px", background: "#f1f5f9", color: "#334155", padding: "4px 10px", borderRadius: "6px", fontWeight: 600 }}>
                                Rider: {assignedRider}
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "13px", color: "#475569", flexWrap: "wrap" }}>
                              <span>Recipient: <strong>{order.customer_name}</strong></span>
                              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <MapPin size={14} color="#ef4444" /> {order.shipping_address}
                              </span>
                              <span>Value: <strong>₹{order.total_amount.toLocaleString("en-IN")}</strong></span>
                            </div>
                          </div>

                          {/* Operations assigns the rider; the rider records pickup and delivery. */}
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                            <select
                              value={order.rider_id || ""}
                              disabled={["Shipped", "Out for Delivery", "Delivered", "Cancelled"].includes(order.status)}
                              onChange={(e) => handleAssignRider(order.id, e.target.value)}
                              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12.5px", fontWeight: 600, background: "#f8fafc" }}
                            >
                              <option value="">Assign Courier...</option>
                              {fleetRiders.map((r) => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                              ))}
                            </select>

                            <span style={{ color: "#64748b", fontSize: 12 }}>{order.accepted_at ? "Rider accepted" : order.rider_id ? "Waiting for rider acceptance" : "Assign a rider to begin"}</span>
                          </div>
                        </div>

                        {/* Visual 4-Stage Progress Bar */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", background: "#f8fafc", padding: "12px", borderRadius: "10px" }}>
                          {STAGES.map((stage, idx) => {
                            const isCompleted = idx <= currentStepIdx;
                            return (
                              <div
                                key={stage}
                                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
                              >
                                <div
                                  style={{
                                    height: "6px",
                                    borderRadius: "999px",
                                    background: isCompleted ? (order.status === "Delivered" ? "#10b981" : "#f59e0b") : "#cbd5e1",
                                    transition: "background 0.25s ease",
                                  }}
                                />
                                <span style={{ fontSize: "12px", fontWeight: isCompleted ? 700 : 500, color: isCompleted ? "#0f172a" : "#94a3b8" }}>
                                  {idx + 1}. {stage}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 2. ROUTE CORRIDORS & LIVE MAP */}
          {activeTab === "routes" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "20px" }}>
              <div style={{ background: "#0f172a", color: "#fff", padding: "24px", borderRadius: "14px", position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>Active Delivery Routes</h3>
                  <span style={{ color: "#34d399", fontSize: "12px", fontWeight: 700 }}>● {inTransitCount} in transit</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "rgba(255,255,255,0.04)", padding: "14px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {orders.filter((order) => ["Shipped", "Out for Delivery"].includes(order.status)).length === 0 ? <p style={{ color: "#94a3b8", fontSize: "13px" }}>No orders are currently in transit.</p> : orders.filter((order) => ["Shipped", "Out for Delivery"].includes(order.status)).map((order) => (
                    <div key={order.id} style={{ padding: "13px", background: "rgba(15,23,42,0.7)", borderRadius: "10px", borderLeft: "4px solid #38bdf8" }}>
                      <strong>{order.order_number} · {order.status}</strong>
                      <div style={{ marginTop: "5px", color: "#cbd5e1", fontSize: "12px" }}>{order.shipping_address}</div>
                      <div style={{ marginTop: "4px", color: "#94a3b8", fontSize: "11px" }}>Rider: {order.assigned_rider || "Unassigned"}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "#fff", padding: "24px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin: "0 0 14px", fontSize: "16px", fontWeight: 700 }}>Active Drop Pins</h3>
                {orders.filter((order) => order.status !== "Delivered" && order.status !== "Cancelled").length === 0 ? (
                  <p style={{ color: "#64748b", fontSize: "13.5px" }}>No active customer drop addresses queued right now.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {orders.filter((order) => order.status !== "Delivered" && order.status !== "Cancelled").map((o) => (
                      <div key={o.id} style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "10px" }}>
                        <div style={{ fontWeight: 700, fontSize: "14px" }}>{o.order_number} • {o.customer_name}</div>
                        <div style={{ fontSize: "12.5px", color: "#475569", marginTop: "4px" }}>{o.shipping_address}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. DELIVERY FLEET & RIDERS */}
          {activeTab === "fleet" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "20px" }}>
              {fleetRiders.length === 0 && <p style={{ color: "#64748b" }}>No active rider accounts found.</p>}
              {fleetRiders.map((rider) => {
                const riderOrders = orders.filter((order) => order.rider_id === rider.id && !["Delivered", "Cancelled"].includes(order.status));
                return (
                <div key={rider.id} style={{ background: "#fff", padding: "22px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#64748b" }}>Rider #{rider.id}</span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: "999px",
                        fontSize: "12px",
                        fontWeight: 700,
                        background: riderOrders.length ? "#fef3c7" : "#dcfce7",
                        color: riderOrders.length ? "#b45309" : "#15803d",
                      }}
                    >
                      {riderOrders.length ? "Assigned" : "No open drops"}
                    </span>
                  </div>
                  <h3 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>{rider.name}</h3>
                  <div style={{ fontSize: "13px", color: "#475569", marginBottom: "10px" }}>{rider.email}</div>
                  <div style={{ fontSize: "13px", color: "#0f172a", fontWeight: 600, marginBottom: "8px" }}>Open assigned drops: {riderOrders.length}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", paddingTop: "12px", borderTop: "1px solid #f1f5f9", fontSize: "13px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "5px", color: "#64748b" }}>
                      <Phone size={14} /> {rider.phone || "Phone not provided"}
                    </span>
                  </div>
                </div>
              );})}
            </div>
          )}

          {/* 5. COD & RIDER SETTLEMENT */}
          {activeTab === "cod" && (
            <div style={{ background: "#fff", padding: "24px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>Cash-on-Delivery Ledger</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#64748b" }}>Persisted order payment and delivery collection records</p>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "13px", color: "#64748b", fontWeight: 600 }}>COD awaiting collection</div>
                  <div style={{ fontSize: "24px", fontWeight: 800, color: "#b45309", marginTop: "4px" }}>₹{codOutstanding.toLocaleString("en-IN")}</div>
                </div>
                <div><div style={{ fontSize: "13px", color: "#64748b", fontWeight: 600 }}>COD collected</div><div style={{ fontSize: "24px", fontWeight: 800, color: "#15803d", marginTop: "4px" }}>₹{codReceived.toLocaleString("en-IN")}</div></div>
              </div>
              <div style={{ marginTop: "18px", display: "grid", gap: "8px" }}>{codOrders.length === 0 ? <p style={{ color: "#64748b", fontSize: "13px" }}>No COD orders have been recorded.</p> : codOrders.map((order) => <div key={order.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "11px", border: "1px solid #e2e8f0", borderRadius: "9px", fontSize: "12px" }}><span>{order.order_number} · {order.assigned_rider || "Unassigned"}</span><strong>₹{Number(order.total_amount).toLocaleString("en-IN")} · {order.cod_collected ? "Collected" : order.status === "Cancelled" ? "Cancelled" : "Due"}</strong></div>)}</div>
            </div>
          )}

          {/* 6. SLA & ROUTE ANALYTICS */}
          {activeTab === "analytics" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "20px" }}>
              <div style={{ background: "#fff", padding: "24px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>Completed Drop Volume</h3>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {["week", "month"].map((v) => (
                      <button
                        key={v}
                        onClick={() => setChartView(v)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: "6px",
                          border: "none",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          background: chartView === v ? "#0f172a" : "#f1f5f9",
                          color: chartView === v ? "#fff" : "#475569",
                        }}
                      >
                        {v === "week" ? "7 Days" : "30 Days"}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: "16px", height: "180px", paddingTop: "16px" }}>
                  {slaBars.map((b) => (
                    <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", marginBottom: "6px" }}>{b.drops}</span>
                      <div style={{ width: "100%", flex: 1, display: "flex", alignItems: "flex-end" }}>
                        <div style={{ width: "100%", height: `${b.pct}%`, background: "linear-gradient(180deg, #f59e0b 0%, #d97706 100%)", borderRadius: "6px 6px 0 0" }} />
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 600, marginTop: "8px" }}>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "#fff", padding: "24px", borderRadius: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "18px" }}>Persisted Delivery Incidents</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "260px", overflowY: "auto" }}>
                  {incidents.length === 0 ? <p style={{ color: "#64748b", fontSize: "13px" }}>No delivery incidents have been recorded.</p> : incidents.slice(0, 12).map((incident) => <div key={incident.id} style={{ padding: "10px", border: "1px solid #e2e8f0", borderRadius: "9px" }}><strong style={{ fontSize: "12px" }}>{incident.order_number} · {incident.reason}</strong><div style={{ marginTop: "3px", color: "#64748b", fontSize: "11px" }}>{incident.rider_name} · {new Date(incident.created_at).toLocaleString()}</div></div>)}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
