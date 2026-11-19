import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import NotificationBell from "../../components/NotificationBell";
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, Compass, LayoutDashboard, LogOut, MapPin, Navigation, Package, Phone, Radar, RefreshCw, ShieldCheck, Wallet, Zap } from "lucide-react";
import "./RiderDashboard.css";

const API = "http://127.0.0.1:8000";
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const INCIDENT_REASONS = ["Customer Unreachable", "Gate Restricted", "Reschedule Requested"];

export default function RiderDashboard() {
  const navigate = useNavigate();
  const riderId = Number(localStorage.getItem("nexcart_rider_id"));
  const token = localStorage.getItem("nexcart_rider_token");
  const riderName = localStorage.getItem("nexcart_rider_name") || "Rider";
  const [orders, setOrders] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [otpValues, setOtpValues] = useState({});
  const [issueOrderId, setIssueOrderId] = useState(null);
  const [tab, setTab] = useState("active");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const riderStartLocationKey = `nexcart_rider_start_location_${riderId}`;
  const [riderStartLocation, setRiderStartLocation] = useState(() => localStorage.getItem(riderStartLocationKey) || "");
  const [startLocationInput, setStartLocationInput] = useState(() => localStorage.getItem(riderStartLocationKey) || "");

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const saveRiderStartLocation = () => {
    const location = startLocationInput.trim();
    if (!location) return notify("Enter your current address or coordinates first.");
    localStorage.setItem(riderStartLocationKey, location);
    setRiderStartLocation(location);
    notify("Starting location saved. Route updated to the store pickup.");
  };

  const loadDashboard = useCallback(async () => {
    try {
      const [orderResponse, incidentResponse, walletResponse] = await Promise.all([
        axios.get(`${API}/delivery/rider/orders`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/delivery/incidents`),
        riderId ? axios.get(`${API}/delivery/wallet/${riderId}`) : Promise.resolve({ data: null }),
      ]);
      const allOrders = Array.isArray(orderResponse.data) ? orderResponse.data : [];
      setOrders(allOrders);
      setIncidents((incidentResponse.data || []).filter((incident) => incident.rider_id === riderId));
      setWallet(walletResponse.data);
      if (!selectedOrderId && allOrders.length) setSelectedOrderId(allOrders[0].id);
    } catch (error) {
      console.error("Failed loading rider data:", error);
      notify("Could not sync rider data with the server.");
    } finally {
      setLoading(false);
    }
  }, [notify, riderId, riderName, selectedOrderId]);

  useEffect(() => {
    loadDashboard();
    const poll = window.setInterval(loadDashboard, 7000);
    return () => window.clearInterval(poll);
  }, [loadDashboard]);

  const activeOrders = useMemo(() => orders.filter((order) => !["Delivered", "Cancelled"].includes(order.status)), [orders]);
  const completedOrders = useMemo(() => orders.filter((order) => order.status === "Delivered"), [orders]);
  const focusedOrder = activeOrders.find((order) => order.id === selectedOrderId) || activeOrders[0] || null;
  const shownOrders = tab === "completed" ? completedOrders : activeOrders;
  const points = activeOrders.slice(0, 6).map((order, index, list) => {
    const angle = (index / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = index % 2 ? 65 : 91;
    return { order, x: 180 + Math.cos(angle) * radius, y: 130 + Math.sin(angle) * radius };
  });
  const focusPoint = points.find((point) => point.order.id === focusedOrder?.id);
  const pickedUp = focusedOrder && ["Shipped", "Out for Delivery"].includes(focusedOrder.status);
  const pickupVendors = focusedOrder?.vendor_details || [];
  const pickupTargets = pickupVendors.map((vendor) => vendor.lat != null && vendor.lng != null ? `${vendor.lat},${vendor.lng}` : vendor.address || "").filter(Boolean);
  const pickupTarget = pickupTargets[pickupTargets.length - 1] || "";
  const customerTarget = focusedOrder?.customer_lat != null && focusedOrder?.customer_lng != null ? `${focusedOrder.customer_lat},${focusedOrder.customer_lng}` : focusedOrder?.shipping_address || "";
  const navigationQuery = pickedUp ? customerTarget : pickupTarget;
  const storeOrigin = pickupTarget;
  const routeOrigin = pickedUp ? storeOrigin : riderStartLocation;
  const directionsParams = new URLSearchParams({ api: "1", destination: navigationQuery, travelmode: "driving" });
  if (routeOrigin) directionsParams.set("origin", routeOrigin);
  if (!pickedUp && pickupTargets.length > 1) directionsParams.set("waypoints", pickupTargets.slice(0, -1).join("|"));
  const directionsUrl = `https://www.google.com/maps/dir/?${directionsParams.toString()}`;
  const routeMapParams = new URLSearchParams({
    output: "embed",
    daddr: pickedUp ? customerTarget : pickupTargets.join(" to: ") || pickupTarget,
  });
  if (routeOrigin) routeMapParams.set("saddr", routeOrigin);

  const acceptDelivery = async (order) => {
    setBusy(true);
    try {
      await axios.post(`${API}/delivery/orders/${order.id}/accept`, {}, { headers: { Authorization: `Bearer ${token}` } });
      await loadDashboard();
      notify("Delivery accepted. Navigate to the vendor pickup.");
    } catch (error) {
      notify(error.response?.data?.detail || "Could not accept this delivery.");
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (orderId, status) => {
    setBusy(true);
    try {
      await axios.patch(`${API}/delivery/orders/${orderId}/status`, { status }, { headers: { Authorization: `Bearer ${token}` } });
      await loadDashboard();
      notify(status === "Out for Delivery" ? "Route started." : "Pickup confirmed.");
    } catch (error) {
      notify(error.response?.data?.detail || "Could not update delivery status.");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (orderId) => {
    const otp = (otpValues[orderId] || "").trim();
    if (!/^\d{4}$/.test(otp)) return notify("Enter the customer's four-digit OTP.");
    setBusy(true);
    try {
      await axios.post(`${API}/delivery/orders/${orderId}/verify-otp`, { otp }, { headers: { Authorization: `Bearer ${token}` } });
      setOtpValues((previous) => ({ ...previous, [orderId]: "" }));
      await loadDashboard();
      notify("OTP verified. Delivery completed.");
    } catch (error) {
      notify(error.response?.data?.detail || "OTP verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const recordIncident = async (order, reason) => {
    setBusy(true);
    try {
      await axios.post(`${API}/delivery/orders/${order.id}/incident`, { rider_id: riderId, reason });
      setIssueOrderId(null);
      await loadDashboard();
      notify("Delivery exception saved.");
    } catch (error) {
      notify(error.response?.data?.detail || "Could not save delivery exception.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!wallet?.available_payout) return notify("No rider earnings are available to withdraw.");
    setBusy(true);
    try {
      await axios.post(`${API}/delivery/wallet/${riderId}/withdraw`, {});
      await loadDashboard();
      notify("UPI payout request saved.");
    } catch (error) {
      notify(error.response?.data?.detail || "Could not request payout.");
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    ["nexcart_rider_token", "nexcart_rider_id", "nexcart_rider_name"].forEach((key) => localStorage.removeItem(key));
    navigate("/rider/login");
  };

  return <div className="rider-hud theme-light">
    <aside className="rider-sidebar">
      <a className="rider-sidebar-brand" href="/rider/dashboard"><span><Navigation size={19} /></span><div><strong>NexCart <i>Rider Ops</i></strong><small>DELIVERY PARTNER</small></div></a>
      <div className="rider-sidebar-profile"><span className="rider-avatar">{riderName.slice(0, 1).toUpperCase()}</span><div><strong>{riderName}</strong><small>Rider · Unit {riderId || "—"}</small></div><span className="rider-online-dot" title="Online" /></div>
      <span className="rider-nav-label">WORKSPACE</span>
      <nav className="rider-nav" aria-label="Rider dashboard">
        <button type="button" className={tab === "active" ? "selected" : ""} onClick={() => setTab("active")}><LayoutDashboard size={17} />Dashboard<span>{activeOrders.length}</span></button>
        <button type="button" className={tab === "completed" ? "selected" : ""} onClick={() => setTab("completed")}><CheckCircle2 size={17} />Completed</button>
        <button type="button" className={tab === "wallet" ? "selected" : ""} onClick={() => setTab("wallet")}><Wallet size={17} />Wallet & incidents</button>
      </nav>
      <div className="rider-sidebar-bottom">
        <button type="button" className="rider-logout-button" onClick={logout}><LogOut size={17} />Sign out</button>
        <small className="rider-sidebar-version">NEXCART RIDER PORTAL</small>
      </div>
    </aside>
    <div className="rider-workspace">
    <header className="hud-topbar"><div className="hud-brand"><span><Navigation size={19} /></span><div><strong>NEXCART <i>RIDER OPS</i></strong><small>UNIT {riderId || "—"} · {riderName}</small></div></div><div className="hud-live"><span /> DATABASE SYNC · 7 SEC</div><div className="hud-controls"><NotificationBell role="rider" userId={riderId} /><button type="button" onClick={loadDashboard} aria-label="Sync now"><RefreshCw size={16} /></button><button type="button" onClick={logout} aria-label="Log out"><LogOut size={16} /></button></div></header>

    <main className="hud-main">
      <section className="hud-heading"><div><span><Activity size={13} /> LIVE SHIFT DATA</span><h1>Good run, {riderName.split(" ")[0]}.</h1><p>Assigned orders, delivery wallet, and saved incidents.</p></div><div className="hud-sync-status"><span /> SYSTEM ONLINE</div></section>

      <section className="hud-metrics">
        <article><span><Wallet size={15} /> EARNED</span><strong>{money(wallet?.earned)}</strong><small>From completed delivery fees</small></article>
        <article><span><Compass size={15} /> OPEN STOPS</span><strong>{activeOrders.length}</strong><small>{completedOrders.length} completed</small></article>
        <article><span><ArrowUpRight size={15} /> AVAILABLE PAYOUT</span><strong>{money(wallet?.available_payout)}</strong><button type="button" onClick={withdraw} disabled={busy || !wallet?.available_payout}>Request UPI payout</button></article>
        <article><span><Zap size={15} /> COD TO COLLECT</span><strong>{money(wallet?.cod_pending)}</strong><small>Collected: {money(wallet?.cod_collected)}</small></article>
      </section>

      <div className="hud-grid">
        <section className="hud-panel map-panel"><div className="panel-heading"><div><span><Radar size={15} /> ASSIGNED ROUTE RADAR</span><h2>{focusedOrder ? focusedOrder.order_number : "No active stop"}</h2></div><span className="radar-count">{activeOrders.length} STOPS</span></div>
          <div className="radar-view"><div className="radar-grid" /><div className="radar-circle circle-a" /><div className="radar-circle circle-b" /><div className="radar-circle circle-c" /><div className="radar-sweep" />
            <svg viewBox="0 0 360 260" role="img" aria-label="Route radar with assigned stops">
              {focusPoint && <path d={`M 180 130 Q ${(180 + focusPoint.x) / 2 + 20} ${(130 + focusPoint.y) / 2 - 22} ${focusPoint.x} ${focusPoint.y}`} />}
              {points.map(({ order, x, y }, index) => <g key={order.id} role="button" tabIndex="0" aria-label={`Select ${order.order_number}`} onClick={() => setSelectedOrderId(order.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedOrderId(order.id); }} className={focusedOrder?.id === order.id ? "active-blip" : "route-blip"}><circle className="blip-halo" cx={x} cy={y} r="13" /><circle className="blip" cx={x} cy={y} r="5" /><text x={x + 11} y={y - 8}>{index + 1}</text></g>)}
              <g className="rider-pin"><circle cx="180" cy="130" r="11" /><path d="M180 122v16M172 130h16" /></g>
            </svg><span className="you-label">YOU</span><span className="radar-coords">SCHEMATIC · STOP SEQUENCE</span>
          </div>
          {focusedOrder ? (
            <>
              <div className="route-destination"><span>{pickedUp ? "CUSTOMER DROP-OFF" : `VENDOR PICKUP${pickupVendors.length > 1 ? ` · ${pickupVendors.length} STOPS` : ""}`}</span><strong>{pickedUp ? focusedOrder.customer_name : pickupVendors.map((vendor) => vendor.name).filter(Boolean).join(" → ") || "Vendor location needed"}</strong><small>{pickedUp ? navigationQuery || "Customer delivery address is missing." : pickupVendors.map((vendor) => vendor.address || (vendor.lat != null && vendor.lng != null ? `${vendor.lat}, ${vendor.lng}` : "Pickup address missing")).join(" · ") || "Ask the vendor to add a pickup address in Store Settings."}</small>{!pickedUp && !riderStartLocation && <small>Set your current starting location below to create the route.</small>}{navigationQuery && routeOrigin && <a href={directionsUrl} target="_blank" rel="noreferrer"><Navigation size={14} /> Open driving directions</a>}</div>
              <div className="rider-location-status" aria-live="polite">
                <span>{pickedUp
                  ? `Route starts from pickup location: ${storeOrigin || "Store address missing"}.`
                  : riderStartLocation
                    ? `Current starting location: ${riderStartLocation}`
                    : "Current starting location is not set."}</span>
                {!pickedUp && <div className="rider-location-editor">
                  <input aria-label="Rider starting location" value={startLocationInput} onChange={(event) => setStartLocationInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRiderStartLocation(); }} placeholder="Enter current address or latitude, longitude" />
                  <button className="rider-location-refresh" type="button" onClick={saveRiderStartLocation}>{riderStartLocation ? "Update starting location" : "Save starting location"}</button>
                </div>}
              </div>
              <div style={{ marginTop: "12px", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
                <iframe
                  title="Route from rider location to next stop"
                  width="100%"
                  height="160"
                  style={{ border: 0, display: "block" }}
                  loading="lazy"
                  src={`https://maps.google.com/maps?${routeMapParams.toString()}`}
                />
              </div>
              <div className="next-stop">
                <div>
                  <small>NEXT WAYPOINT · {focusedOrder.status}</small>
                  <strong>{focusedOrder.customer_name}</strong>
                  <span><MapPin size={13} /> {focusedOrder.shipping_address}</span>
                </div>
                <a href={directionsUrl} target="_blank" rel="noreferrer" aria-label="Open directions">
                  <Navigation size={17} />
                </a>
              </div>
            </>
          ) : <p className="empty-note">No delivery orders are assigned to this rider.</p>}
        </section>

        <section className="hud-panel manifest-panel"><div className="panel-heading"><div><span><Package size={15} /> DELIVERY MANIFEST</span><h2>Assigned orders</h2></div><button className="refresh-button" type="button" onClick={loadDashboard}><RefreshCw size={15} /></button></div>
          <div className="manifest-tabs"><button type="button" className={tab === "active" ? "selected" : ""} onClick={() => setTab("active")}>Active <b>{activeOrders.length}</b></button><button type="button" className={tab === "completed" ? "selected" : ""} onClick={() => setTab("completed")}>Completed <b>{completedOrders.length}</b></button><button type="button" className={tab === "wallet" ? "selected" : ""} onClick={() => setTab("wallet")}>Wallet</button></div>
          {loading ? <div className="empty-note"><span className="loader" />Loading assigned orders…</div> : tab === "wallet" ? <div className="wallet-ledger"><div><strong>COD pending</strong><b>{money(wallet?.cod_pending)}</b></div><div><strong>COD collected</strong><b>{money(wallet?.cod_collected)}</b></div><div><strong>Delivered UPI orders</strong><b>{money(wallet?.upi_delivered_order_value)}</b></div><div><strong>Rider earnings</strong><b>{money(wallet?.earned)}</b></div><h3>Payout requests</h3>{(wallet?.payouts || []).length ? wallet.payouts.map((payout) => <p key={payout.id}>{money(payout.amount)} · {payout.status} · {new Date(payout.created_at).toLocaleString()}</p>) : <p>No payout requests recorded.</p>}<h3>Delivery incidents</h3>{incidents.length ? incidents.map((incident) => <p key={incident.id}>{incident.order_number} · {incident.reason} · {new Date(incident.created_at).toLocaleString()}</p>) : <p>No incidents recorded.</p>}</div> : shownOrders.length === 0 ? <div className="empty-note"><Package size={26} /><strong>{tab === "active" ? "No open stops" : "No completed deliveries"}</strong><span>New assignments will sync automatically.</span></div> : <div className="drop-list">{shownOrders.map((order) => <article key={order.id} className={`drop-card ${focusedOrder?.id === order.id ? "focused" : ""}`} onClick={() => setSelectedOrderId(order.id)}>
            <div className="drop-top"><span>{order.order_number}</span><b className={`status status-${order.status.toLowerCase().replaceAll(" ", "-")}`}>{order.status}</b></div><h3>{order.customer_name}</h3><p className="drop-address"><MapPin size={14} />{order.shipping_address}</p><div className="drop-facts"><span>{money(order.total_amount)}</span><span>{order.payment_method}</span><span>{order.customer_phone || "Phone unavailable"}</span></div>
            {tab === "active" && <div className="drop-controls" onClick={(event) => event.stopPropagation()}>
              {!order.accepted_at && <button type="button" disabled={busy} onClick={() => acceptDelivery(order)}>Accept delivery</button>}
              {order.accepted_at && order.status === "Ready for Pickup" && <button type="button" disabled={busy} onClick={() => updateStatus(order.id, "Picked Up")}>Picked Up</button>}
              {order.accepted_at && order.status === "Shipped" && <button type="button" disabled={busy} onClick={() => updateStatus(order.id, "Out for Delivery")}>Start delivery</button>}
              {order.accepted_at && order.status === "Out for Delivery" && <div className="otp-form"><label><ShieldCheck size={14} /> Customer OTP</label><div><input value={otpValues[order.id] || ""} maxLength={4} inputMode="numeric" autoComplete="one-time-code" placeholder="4 digits" onChange={(event) => setOtpValues((previous) => ({ ...previous, [order.id]: event.target.value.replace(/\D/g, "").slice(0, 4) }))} /><button type="button" disabled={busy} onClick={() => verifyOtp(order.id)}>Delivered <CheckCircle2 size={14} /></button></div></div>}
              <a href={order.customer_phone ? `tel:${order.customer_phone}` : undefined} onClick={(event) => { if (!order.customer_phone) { event.preventDefault(); notify("Customer phone is not on file."); } }}><Phone size={13} /> Call customer</a>
              <button className="issue-button" type="button" onClick={() => setIssueOrderId(issueOrderId === order.id ? null : order.id)}><AlertTriangle size={13} /> Record issue</button>
              {issueOrderId === order.id && <div className="issue-options">{INCIDENT_REASONS.map((reason) => <button type="button" key={reason} disabled={busy} onClick={() => recordIncident(order, reason)}>{reason}</button>)}</div>}
            </div>}
          </article>)}</div>}
        </section>
      </div>
      <footer className="hud-footer"><span><Clock3 size={13} /> API refreshes every 7 seconds</span><span><ShieldCheck size={13} /> OTP checked against persisted order</span></footer>
    </main>
    {toast && <div className="hud-toast" role="status"><Zap size={15} />{toast}</div>}
    </div>
  </div>;
}
