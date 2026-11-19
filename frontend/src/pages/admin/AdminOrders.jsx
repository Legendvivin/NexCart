import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const API = "http://127.0.0.1:8000";
const TABS = ["All", "Processing", "Ready for Pickup", "Shipped", "Out for Delivery", "Delivered", "Cancelled"];
const PAGE_SIZE = 25;
const money = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN")}`;

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [riders, setRiders] = useState([]);
  const [assigningOrderId, setAssigningOrderId] = useState(null);
  const [statusTab, setStatusTab] = useState("All");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/delivery/orders`, { headers: { Authorization: `Bearer ${localStorage.getItem("nexcart_admin_token")}` } });
      setOrders(response.data);
      setError("");
    } catch (loadError) {
      console.error("Failed loading orders:", loadError);
      setError("Orders could not be loaded from the API.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRiders = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/delivery/riders`);
      setRiders(response.data);
    } catch (loadError) {
      console.error("Failed loading delivery partners:", loadError);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    loadRiders();
    const poll = window.setInterval(loadOrders, 15000);
    return () => window.clearInterval(poll);
  }, [loadOrders, loadRiders]);

  const assignRider = async (orderId, riderId) => {
    setAssigningOrderId(orderId);
    try {
      await axios.patch(`${API}/delivery/orders/${orderId}/assign`, {
        rider_id: riderId ? Number(riderId) : null,
      }, { headers: { Authorization: `Bearer ${localStorage.getItem("nexcart_admin_token")}` } });
      await loadOrders();
    } catch (assignmentError) {
      setError(assignmentError.response?.data?.detail || "Driver assignment could not be saved.");
    } finally {
      setAssigningOrderId(null);
    }
  };

  const filteredOrders = orders.filter((order) => {
    const matchesTab = statusTab === "All" || order.status === statusTab;
    const query = search.toLowerCase();
    return matchesTab && `${order.order_number} ${order.customer_name}`.toLowerCase().includes(query);
  });
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pageOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <div>
    <div style={{ marginBottom: "20px" }}><h1 style={{ fontSize: "24px", fontWeight: 700 }}>Orders Management</h1><p style={{ color: "#64748b", fontSize: "14px" }}>Live order records, payment method, and delivery status.</p></div>
    {error && <p role="alert" style={{ color: "#b91c1c", fontSize: "13px" }}>{error}</p>}
    <div className="dashboard-panel" style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>{TABS.map((tab) => <button key={tab} type="button" onClick={() => { setStatusTab(tab); setPage(1); }} style={{ padding: "7px 12px", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "12px", background: statusTab === tab ? "#2563eb" : "#f1f5f9", color: statusTab === tab ? "#fff" : "#475569" }}>{tab}</button>)}</div>
      <div style={{ position: "relative", minWidth: "250px" }}><Search size={16} style={{ position: "absolute", left: "12px", top: "10px", color: "#94a3b8" }} /><input type="text" placeholder="Search order or customer…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} style={{ width: "100%", padding: "8px 12px 8px 36px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "14px" }} /></div>
    </div>
    <div className="dashboard-panel" style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>Order ID</th><th>Vendor details</th><th>Customer details</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Driver</th><th>Delivery progress</th></tr></thead><tbody>
      {loading && orders.length === 0 && <tr><td colSpan={10} style={{ color: "#64748b", textAlign: "center" }}>Loading orders…</td></tr>}
      {pageOrders.map((order) => {
        const progress = order.status === "Processing" ? (order.accepted_at ? "Rider accepted · waiting for vendor" : order.rider_id ? "Assigned · waiting for rider" : "Waiting for rider assignment") : order.status === "Ready for Pickup" ? (order.accepted_at ? "Accepted · waiting for pickup" : "Waiting for rider acceptance") : order.status === "Shipped" ? "Picked up · en route" : order.status === "Out for Delivery" ? "On the way to customer" : order.status;
        return <tr key={order.id}><td style={{ fontWeight: 700, color: "#2563eb" }}>{order.order_number}</td><td>{(order.vendor_details || []).map((vendor) => <div key={vendor.vendor_id} style={{ minWidth: 170, marginBottom: 6 }}><strong style={{ display: "block" }}>{vendor.name}</strong><span style={{ display: "block", color: "#64748b", fontSize: 11 }}>{vendor.phone || "Phone unavailable"}</span><span style={{ color: "#64748b", fontSize: 11 }}>{vendor.address || "Pickup address not set"}</span></div>)}</td><td><strong style={{ display: "block", fontWeight: 600 }}>{order.customer_name}</strong><span style={{ display: "block", marginTop: 3, color: "#64748b", fontSize: 12 }}>{order.customer_email || "Email unavailable"}</span><span style={{ display: "block", color: "#64748b", fontSize: 12 }}>{order.customer_phone || "Mobile unavailable"}</span><span style={{ color: "#64748b", fontSize: 11 }}>{order.shipping_address}</span></td><td>{order.created_at ? new Date(order.created_at).toLocaleDateString() : "—"}</td><td>{order.item_count ?? 0}</td><td style={{ fontWeight: 600 }}>{money(order.total_amount)}</td><td>{order.payment_method}</td><td><span className={`status-pill status-${String(order.status).toLowerCase().replaceAll(" ", "-")}`}>{order.status}</span></td><td><select aria-label={`Assign driver for ${order.order_number}`} value={order.rider_id || ""} disabled={assigningOrderId === order.id || ["Shipped", "Out for Delivery", "Delivered", "Cancelled"].includes(order.status)} onChange={(event) => assignRider(order.id, event.target.value)}><option value="">Unassigned</option>{riders.map((rider) => <option key={rider.id} value={rider.id}>{rider.name}</option>)}</select></td><td><span style={{ color: "#64748b", fontSize: 12 }}>{progress}</span></td></tr>;
      })}
    </tbody></table>{!loading && filteredOrders.length === 0 && <p style={{ color: "#64748b", fontSize: "13px" }}>No orders match this filter.</p>}
      {filteredOrders.length > PAGE_SIZE && <div className="admin-orders-pagination"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length} orders</span><div><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /> Previous</button><span>Page {page} of {pageCount}</span><button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next <ChevronRight size={16} /></button></div></div>}
    </div>
  </div>;
}
