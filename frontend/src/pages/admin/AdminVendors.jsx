import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Ban, Check, Store, ShieldCheck, ShieldAlert } from "lucide-react";

const API = "http://127.0.0.1:8000/admin/vendors";
const money = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN")}`;

export default function AdminVendors() {
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState("");

  const loadVendors = useCallback(async () => {
    try {
      const response = await axios.get(API);
      setVendors(response.data);
      setError("");
    } catch (loadError) {
      console.error("Failed loading vendors:", loadError);
      setError("Vendor records could not be loaded.");
    }
  }, []);

  useEffect(() => {
    loadVendors();
    const poll = window.setInterval(loadVendors, 7000);
    return () => window.clearInterval(poll);
  }, [loadVendors]);

  const updateVendorStatus = async (vendor, status) => {
    try {
      await axios.patch(`${API}/${vendor.id}/status`, { status });
      loadVendors();
    } catch (updateError) {
      setError(updateError.response?.data?.detail || "Vendor status could not be changed.");
    }
  };

  const updateVendorKyc = async (vendor, kyc_status) => {
    try {
      await axios.patch(`${API}/${vendor.id}/kyc`, { kyc_status });
      loadVendors();
    } catch (updateError) {
      setError(updateError.response?.data?.detail || "Vendor KYC status could not be changed.");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700 }}>Vendor Governance & KYC</h1>
        <p style={{ color: "#64748b", fontSize: "14px" }}>
          Manage vendor profiles, commission rates, and KYC approvals.
        </p>
      </div>
      {error && <p role="alert" style={{ color: "#b91c1c", fontSize: "13px" }}>{error}</p>}

      <div className="dashboard-panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Vendor ID</th>
              <th>Store & Owner</th>
              <th>GST / Bank Details</th>
              <th>Commission</th>
              <th>Products</th>
              <th>Total Sales</th>
              <th>KYC Status</th>
              <th>Account</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((vendor) => (
              <tr key={vendor.id}>
                <td>#{vendor.id}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                    <Store size={16} color="#2563eb" />
                    {vendor.store_name || vendor.owner}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "12px" }}>
                    {vendor.owner} · {vendor.email}
                  </div>
                </td>
                <td style={{ fontSize: "12px" }}>
                  <div><strong>GST:</strong> {vendor.gst_number || "—"}</div>
                  <div style={{ color: "#64748b" }}><strong>A/C:</strong> {vendor.bank_account || "—"}</div>
                </td>
                <td style={{ fontWeight: 600 }}>{vendor.commission_rate}%</td>
                <td>{vendor.products} items</td>
                <td style={{ fontWeight: 600 }}>{money(vendor.revenue)}</td>
                <td>
                  <select
                    value={vendor.kyc_status}
                    onChange={(e) => updateVendorKyc(vendor, e.target.value)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      background: vendor.kyc_status === "Approved" ? "#dcfce7" : vendor.kyc_status === "Pending" ? "#fef3c7" : "#fee2e2",
                      color: vendor.kyc_status === "Approved" ? "#166534" : vendor.kyc_status === "Pending" ? "#b45309" : "#991b1b",
                      border: "1px solid #cbd5e1",
                      cursor: "pointer",
                    }}
                  >
                    <option value="Approved">Approved</option>
                    <option value="Pending">Pending</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </td>
                <td>
                  <span className={`status-pill status-${vendor.status.toLowerCase()}`}>
                    {vendor.status}
                  </span>
                </td>
                <td>
                  {vendor.status === "Active" ? (
                    <button
                      type="button"
                      onClick={() => updateVendorStatus(vendor, "Suspended")}
                      style={{ background: "#fee2e2", color: "#991b1b", border: 0, padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}
                    >
                      <Ban size={14} /> Suspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateVendorStatus(vendor, "Active")}
                      style={{ background: "#dcfce7", color: "#166534", border: 0, padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}
                    >
                      <Check size={14} /> Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {vendors.length === 0 && <p style={{ color: "#64748b", fontSize: "13px" }}>No vendor accounts registered yet.</p>}
      </div>
    </div>
  );
}
