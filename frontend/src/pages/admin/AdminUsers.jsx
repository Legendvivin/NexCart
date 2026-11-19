import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";

const API = "http://127.0.0.1:8000/admin/users";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const loadUsers = useCallback(async () => {
    try {
      const response = await axios.get(API);
      setUsers(response.data);
      setError("");
    } catch (loadError) {
      console.error("Failed loading customer directory:", loadError);
      setError("Customer records could not be loaded.");
    }
  }, []);
  useEffect(() => {
    loadUsers();
    const poll = window.setInterval(loadUsers, 7000);
    return () => window.clearInterval(poll);
  }, [loadUsers]);

  const setActive = async (user) => {
    try {
      await axios.patch(`${API}/${user.id}/status`, { is_active: !user.active });
      loadUsers();
    } catch (updateError) {
      setError(updateError.response?.data?.detail || "Account status could not be changed.");
    }
  };
  const filtered = users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()));

  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}><div><h1 style={{ fontSize: "24px", fontWeight: 700 }}>Customer Directory</h1><p style={{ color: "#64748b", fontSize: "14px" }}>Customer totals and account status.</p></div><div style={{ position: "relative", minWidth: "260px" }}><Search size={16} style={{ position: "absolute", left: "12px", top: "10px", color: "#94a3b8" }} /><input type="text" placeholder="Search name or email…" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: "100%", padding: "8px 12px 8px 36px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "14px" }} /></div></div>
    {error && <p role="alert" style={{ color: "#b91c1c", fontSize: "13px" }}>{error}</p>}
    <div className="dashboard-panel" style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>User ID</th><th>Customer</th><th>Email / Phone</th><th>Orders</th><th>Total Spent</th><th>Joined</th><th>Account</th></tr></thead><tbody>
      {filtered.map((user) => <tr key={user.id}><td>{user.id}</td><td style={{ fontWeight: 600 }}>{user.name}</td><td>{user.email}<div style={{ color: "#64748b", fontSize: "12px" }}>{user.phone || "Phone not provided"}</div></td><td>{user.orders}</td><td>₹{Number(user.spent).toLocaleString("en-IN")}</td><td>{user.joined ? new Date(user.joined).toLocaleDateString() : "—"}</td><td><button type="button" onClick={() => setActive(user)} style={{ background: user.active ? "#dcfce7" : "#fee2e2", color: user.active ? "#166534" : "#991b1b", border: 0, padding: "5px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "5px" }}>{user.active ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{user.active ? "Active" : "Blocked"}</button></td></tr>)}
    </tbody></table>{filtered.length === 0 && <p style={{ color: "#64748b", fontSize: "13px" }}>No customer records match this search.</p>}</div>
  </div>;
}
