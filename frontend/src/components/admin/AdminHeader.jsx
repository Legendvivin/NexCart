import { UserCircle, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import NotificationBell from "../NotificationBell";

export default function AdminHeader() {
  const navigate = useNavigate();
  const [adminName, setAdminName] = useState(() => localStorage.getItem("nexcart_admin_name") || "Super Admin");

  useEffect(() => {
    const updateName = () => setAdminName(localStorage.getItem("nexcart_admin_name") || "Super Admin");
    window.addEventListener("nexcart-admin-profile-updated", updateName);
    return () => window.removeEventListener("nexcart-admin-profile-updated", updateName);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("nexcart_admin_token");
    localStorage.removeItem("nexcart_role");
    navigate("/admin/login");
  };

  return (
    <header className="admin-header">
      <div>
        <h3 style={{ fontSize: "16px", fontWeight: 600 }}>Admin Control Center</h3>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
        <NotificationBell role="admin" userId={localStorage.getItem("nexcart_admin_id")} />
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <UserCircle size={26} color="#2563eb" />
          <span className="admin-header-user-name" style={{ fontSize: "14px", fontWeight: 600 }}>{adminName}</span>
        </div>
        <button
          onClick={handleLogout}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "#fee2e2",
            color: "#b91c1c",
            border: "none",
            padding: "6px 12px",
            borderRadius: "6px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <LogOut size={15} /> <span className="admin-header-logout-label">Logout</span>
        </button>
      </div>
    </header>
  );
}
