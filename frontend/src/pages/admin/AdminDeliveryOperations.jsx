import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Activity, CheckCircle2, PackageCheck, Phone, Truck, UserRound, Users, ShieldCheck, X } from "lucide-react";

const API = "http://127.0.0.1:8000";
export default function AdminDeliveryOperations() {
  const [riders, setRiders] = useState([]);
  const [orders, setOrders] = useState([]);
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reviewingId, setReviewingId] = useState(null);

  const loadFleet = useCallback(async () => {
    try {
      const [riderResponse, orderResponse, applicationResponse] = await Promise.all([
        axios.get(`${API}/delivery/riders`),
        axios.get(`${API}/delivery/orders`, { headers: { Authorization: `Bearer ${localStorage.getItem("nexcart_admin_token")}` } }),
        axios.get(`${API}/delivery/rider-applications`, { headers: { Authorization: `Bearer ${localStorage.getItem("nexcart_admin_token")}` } }),
      ]);
      setRiders(riderResponse.data);
      setOrders(orderResponse.data);
      setApplications(applicationResponse.data);
      setError("");
    } catch (loadError) {
      console.error("Failed to load delivery operations:", loadError);
      setError("Delivery fleet data could not be loaded.");
    }
  }, []);

  const reviewApplication = async (application, status) => {
    setReviewingId(application.id);
    setError("");
    setSuccess("");
    try {
      const token = localStorage.getItem("nexcart_admin_token");
      await axios.patch(`${API}/delivery/rider-applications/${application.id}/status`, { status }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess(`${application.name}'s application ${status.toLowerCase()}.`);
      await loadFleet();
    } catch (reviewError) {
      setError(reviewError.response?.data?.detail || "Application status could not be saved.");
    } finally {
      setReviewingId(null);
    }
  };

  useEffect(() => {
    loadFleet();
    const poll = window.setInterval(loadFleet, 7000);
    return () => window.clearInterval(poll);
  }, [loadFleet]);

  const fleetMetrics = useMemo(() => {
    const open = orders.filter((order) => !["Delivered", "Cancelled"].includes(order.status));
    return [
      { label: "Delivery partners", value: riders.length, icon: Users, tone: "purple" },
      { label: "Pending applications", value: applications.filter((application) => application.status === "Pending").length, icon: UserRound, tone: "amber" },
      { label: "Open deliveries", value: open.length, icon: PackageCheck, tone: "sage" },
      { label: "Need a driver", value: open.filter((order) => !order.rider_id).length, icon: UserRound, tone: "amber" },
      { label: "In transit", value: orders.filter((order) => ["Shipped", "Out for Delivery"].includes(order.status)).length, icon: Activity, tone: "blue" },
    ];
  }, [orders, riders]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Delivery Operations & Fleet</h1>
        <p style={{ color: "#64748b", fontSize: 14 }}>Manage delivery partners and monitor fulfillment activity.</p>
      </div>
      {error && <p role="alert" style={{ marginBottom: 14, color: "#b91c1c", fontSize: 13 }}>{error}</p>}
      {success && <p role="status" style={{ marginBottom: 14, color: "#166534", fontSize: 13 }}>{success}</p>}
      <div className="admin-fleet-metrics">
        {fleetMetrics.map(({ label, value, icon: Icon, tone }) => <article className={`admin-fleet-metric tone-${tone}`} key={label}>
          <span className="admin-fleet-metric-icon"><Icon size={19} /></span>
          <div><span>{label}</span><strong>{value}</strong></div>
        </article>)}
      </div>

      <section className="dashboard-panel admin-rider-applications">
        <div className="panel-header"><div><h2 style={{ fontSize: 17, fontWeight: 700 }}>Delivery partner applications</h2><p style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>Review new rider accounts before they can sign in.</p></div></div>
        {applications.length === 0 ? <div className="admin-fleet-empty"><UserRound size={22} /><strong>No applications to review</strong><span>New delivery partner registrations will appear here.</span></div> : <div style={{ overflowX: "auto" }}>
          <table className="data-table"><thead><tr><th>Applicant</th><th>Contact</th><th>Applied</th><th>Status</th><th>Review</th></tr></thead><tbody>
            {applications.map((application) => <tr key={application.id}>
              <td><strong>{application.name}</strong></td>
              <td><span className="admin-rider-application-contact">{application.email}</span>{application.phone && <span className="admin-rider-application-contact">{application.phone}</span>}</td>
              <td>{application.applied_at ? new Date(application.applied_at).toLocaleDateString() : "—"}</td>
              <td><span className={`admin-application-status status-${application.status.toLowerCase()}`}>{application.status}</span></td>
              <td>{application.status === "Pending" ? <div className="admin-application-actions">
                <button type="button" className="admin-application-approve" disabled={reviewingId === application.id} onClick={() => reviewApplication(application, "Approved")}><ShieldCheck size={14} /> Approve</button>
                <button type="button" className="admin-application-reject" disabled={reviewingId === application.id} onClick={() => reviewApplication(application, "Rejected")}><X size={14} /> Reject</button>
              </div> : "—"}</td>
            </tr>)}
          </tbody></table>
        </div>}
      </section>

      <section className="dashboard-panel admin-fleet-roster">
        <div className="panel-header"><div><h2 style={{ fontSize: 17, fontWeight: 700 }}>Delivery partner roster</h2><p style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>Current workloads update automatically.</p></div><span className="admin-fleet-live"><span /> Live roster</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Delivery partner</th><th>Contact</th><th>Assigned orders</th><th>In transit</th><th>Completed</th></tr></thead>
            <tbody>
              {riders.map((rider) => {
                const riderOrders = orders.filter((order) => order.rider_id === rider.id);
                return <tr key={rider.id}>
                  <td><strong className="admin-rider-name"><Truck size={16} />{rider.name}</strong></td>
                  <td>{rider.phone ? <span className="admin-rider-contact"><Phone size={13} />{rider.phone}</span> : rider.email}</td>
                  <td>{riderOrders.filter((order) => !["Delivered", "Cancelled"].includes(order.status)).length}</td>
                  <td>{riderOrders.filter((order) => ["Shipped", "Out for Delivery"].includes(order.status)).length}</td>
                  <td><span className="admin-rider-completed"><CheckCircle2 size={14} />{riderOrders.filter((order) => order.status === "Delivered").length}</span></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {riders.length === 0 && <div className="admin-fleet-empty"><UserRound size={22} /><strong>No delivery partners yet</strong><span>Delivery partners will appear here when accounts are available.</span></div>}
      </section>
    </div>
  );
}
