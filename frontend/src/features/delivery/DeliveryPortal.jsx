import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import "./Auth.css";

export default function DeliveryManagerLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await axios.post("http://127.0.0.1:8000/delivery/login", {
        email,
        password,
      });
      localStorage.setItem("nexcart_delivery_token", res.data.access_token);
      localStorage.setItem("nexcart_delivery_name", res.data.full_name);
      navigate("/delivery/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Delivery login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <span className="auth-badge badge-delivery">Logistics Hub</span>
        <h1 className="auth-title">NexCart Delivery</h1>
        <p className="auth-subtitle">Dispatch orders, track routes, and confirm deliveries.</p>

        {error && <div className="auth-error" style={{ marginBottom: "16px" }}>{error}</div>}

        <form onSubmit={handleLogin} className="auth-form">
          <div className="auth-group">
            <label>Logistics Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="auth-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="auth-btn" style={{ background: "#f59e0b" }} disabled={loading}>
            {loading ? "Signing In..." : "Enter Dispatch Console"}
          </button>
        </form>

        <div className="portal-links">
          <Link to="/admin/login">Admin</Link>
          <Link to="/vendor/login">Vendor</Link>
          <Link to="/login">Customer</Link>
        </div>
      </div>
    </div>
  );
}
