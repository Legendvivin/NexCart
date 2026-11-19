import { useState, useEffect } from "react";
import { Search, Eye, Trash2, CheckCircle, XCircle } from "lucide-react";
import adminApi from "../../services/adminApi";

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [terms, setTerms] = useState({ emi_offer: "", special_offer: "", replacement_policy: "", coupon_code: "", coupon_percent: 0 });
  const [savingTerms, setSavingTerms] = useState(false);
  const [termsMessage, setTermsMessage] = useState("");

  const fetchProducts = async () => {
    try {
      const res = await adminApi.get("/admin/products/");
      setProducts(res.data);
    } catch (err) {
      console.error("Failed to fetch products:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    const poll = window.setInterval(fetchProducts, 7000);
    return () => window.clearInterval(poll);
  }, []);

  const categories = ["All", ...new Set(products.map((p) => p.category))];

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.vendor.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "All" || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleSetStatus = async (id, status) => {
    try {
      const res = await adminApi.patch(`/admin/products/${id}/status`, { status });
      setProducts(
        products.map((p) => (p.id === id ? { ...p, status: res.data.status } : p))
      );
    } catch (err) {
      console.error("Status update failed:", err);
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      const res = await adminApi.patch(`/admin/products/${id}/toggle-status`);
      setProducts(
        products.map((p) => (p.id === id ? { ...p, status: res.data.status } : p))
      );
    } catch (err) {
      console.error("Status toggle failed:", err);
    }
  };

  const handleDelete = async (id) => {
    try {
      await adminApi.delete(`/admin/products/${id}`);
      setProducts(products.filter((p) => p.id !== id));
      if (selectedProduct?.id === id) setSelectedProduct(null);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const openProduct = (product) => {
    setSelectedProduct(product);
    setTerms({ emi_offer: product.admin_terms?.emi_offer || "", special_offer: product.admin_terms?.special_offer || "", replacement_policy: product.admin_terms?.replacement_policy || "", coupon_code: product.admin_terms?.coupon_code || "", coupon_percent: product.admin_terms?.coupon_percent || 0 });
    setTermsMessage("");
  };

  const saveTerms = async () => {
    setSavingTerms(true);
    setTermsMessage("");
    try {
      const res = await adminApi.put(`/admin/products/${selectedProduct.id}/terms`, terms);
      const updated = { ...selectedProduct, admin_terms: res.data.admin_terms };
      setSelectedProduct(updated);
      setProducts((current) => current.map((product) => product.id === updated.id ? updated : product));
      setTermsMessage("Product offers and policy saved.");
    } catch (err) {
      setTermsMessage(err.response?.data?.detail || "Could not save product terms.");
    } finally {
      setSavingTerms(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700 }}>Products Catalog</h1>
        <p style={{ color: "#64748b", fontSize: "14px" }}>
          Review vendor listings and approve new items.
        </p>
      </div>

      {/* Category Tabs & Search Bar */}
      <div className="dashboard-panel" style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{
                padding: "7px 14px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "13px",
                background: categoryFilter === cat ? "#2563eb" : "#f1f5f9",
                color: categoryFilter === cat ? "#ffffff" : "#475569",
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", minWidth: "260px" }}>
          <Search size={16} style={{ position: "absolute", left: "12px", top: "10px", color: "#94a3b8" }} />
          <input
            type="text"
            placeholder="Search product or vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px 8px 36px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "14px" }}
          />
        </div>
      </div>

      {/* Product Table */}
      <div className="dashboard-panel">
        {loading ? (
          <p style={{ color: "#64748b" }}>Loading products...</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Product</th>
                <th>Vendor</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.code}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.vendor}</td>
                  <td>{p.category}</td>
                  <td>₹{p.price.toLocaleString("en-IN")}</td>
                  <td>{p.stock} units</td>
                  <td>
                    <span
                      className={`status-pill ${
                        p.status === "Approved"
                          ? "status-delivered"
                          : p.status === "Pending"
                          ? "status-pending"
                          : "status-shipped"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={() => openProduct(p)}
                      title="Inspect Details"
                      style={{ background: "#eff6ff", color: "#2563eb", border: "none", padding: "6px", borderRadius: "6px", cursor: "pointer" }}
                    >
                      <Eye size={16} />
                    </button>
                    {p.status !== "Approved" && (
                      <button
                        onClick={() => handleSetStatus(p.id, "Approved")}
                        title="Approve Product"
                        style={{ background: "#dcfce7", color: "#166534", border: "none", padding: "6px 8px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}
                      >
                        Approve
                      </button>
                    )}
                    {p.status !== "Rejected" && (
                      <button
                        onClick={() => handleSetStatus(p.id, "Rejected")}
                        title="Reject Product"
                        style={{ background: "#fee2e2", color: "#991b1b", border: "none", padding: "6px 8px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}
                      >
                        Reject
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(p.id)}
                      title="Delete Product"
                      style={{ background: "#fef2f2", color: "#dc2626", border: "none", padding: "6px", borderRadius: "6px", cursor: "pointer" }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Product Details Drawer */}
      {selectedProduct && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}
          onClick={() => setSelectedProduct(null)}
        >
          <div
            style={{ width: "min(480px, 100%)", background: "#ffffff", height: "100%", padding: "28px", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>{selectedProduct.name}</h2>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "20px" }}>Product ID: {selectedProduct.code}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "14px" }}>
              <div><strong>Vendor:</strong> {selectedProduct.vendor}</div>
              <div><strong>Category:</strong> {selectedProduct.category}</div>
              <div><strong>Price:</strong> ₹{selectedProduct.price.toLocaleString("en-IN")}</div>
              <div><strong>Stock:</strong> {selectedProduct.stock} units</div>
              <div><strong>Status:</strong> {selectedProduct.status}</div>
              <div><strong>Description:</strong> {selectedProduct.description}</div>
            </div>
            <section style={{ marginTop: "24px", borderTop: "1px solid #e2e8f0", paddingTop: "18px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>Customer offers & policy</h3>
              <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "14px" }}>Admin-managed details shown on the customer product page.</p>
              {[
                ["emi_offer", "EMI offer", "Example: No-cost EMI from ₹X/month on eligible cards."],
                ["special_offer", "Special offer", "Example: 10% off with code SAVE10."],
                ["replacement_policy", "Replacement policy", "Describe eligibility and the replacement window."],
              ].map(([key, label, placeholder]) => (
                <label key={key} style={{ display: "block", marginBottom: "12px", color: "#334155", fontSize: "12px", fontWeight: 650 }}>
                  {label}
                  <textarea value={terms[key]} maxLength={key === "replacement_policy" ? 2000 : 1000} placeholder={placeholder} onChange={(event) => setTerms((current) => ({ ...current, [key]: event.target.value }))} rows={key === "replacement_policy" ? 3 : 2} style={{ display: "block", width: "100%", marginTop: "5px", padding: "9px 10px", border: "1px solid #cbd5e1", borderRadius: "8px", resize: "vertical", font: "inherit", fontWeight: 400 }} />
                </label>
              ))}
              <p style={{ color: "#64748b", fontSize: "11px", margin: "0 0 8px" }}>This coupon applies only to this product and is calculated at checkout.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: "10px", marginBottom: "14px" }}>
                <label style={{ color: "#334155", fontSize: "12px", fontWeight: 650 }}>Coupon code<input value={terms.coupon_code} maxLength={32} placeholder="STEP10" onChange={(event) => setTerms((current) => ({ ...current, coupon_code: event.target.value.toUpperCase().replace(/\s/g, "") }))} style={{ display: "block", width: "100%", height: "38px", marginTop: "5px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "8px" }} /></label>
                <label style={{ color: "#334155", fontSize: "12px", fontWeight: 650 }}>Discount %<input type="number" min="0" max="99" value={terms.coupon_percent} onChange={(event) => setTerms((current) => ({ ...current, coupon_percent: Math.max(0, Math.min(99, Number(event.target.value) || 0)) }))} style={{ display: "block", width: "100%", height: "38px", marginTop: "5px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "8px" }} /></label>
              </div>
              {termsMessage && <p role="status" style={{ color: termsMessage.includes("saved") ? "#15803d" : "#b91c1c", fontSize: "12px" }}>{termsMessage}</p>}
              <button type="button" onClick={saveTerms} disabled={savingTerms} style={{ width: "100%", padding: "10px", background: "#166534", color: "#fff", border: 0, borderRadius: "8px", cursor: savingTerms ? "wait" : "pointer", fontWeight: 650 }}>{savingTerms ? "Saving…" : "Save offers & policy"}</button>
            </section>
            <button
              onClick={() => setSelectedProduct(null)}
              style={{ marginTop: "28px", width: "100%", padding: "10px", background: "#0f172a", color: "#ffffff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600 }}
            >
              Close Drawer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
