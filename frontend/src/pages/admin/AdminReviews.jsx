import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Star, Trash2, MessageSquare } from "lucide-react";

const API = "http://127.0.0.1:8000/admin/reviews";

export default function AdminReviews() {
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState("");

  const loadReviews = useCallback(async () => {
    try {
      const response = await axios.get(API);
      setReviews(response.data);
      setError("");
    } catch (err) {
      console.error("Failed loading reviews:", err);
      setError("Reviews could not be loaded from API.");
    }
  }, []);

  useEffect(() => {
    loadReviews();
    const poll = window.setInterval(loadReviews, 7000);
    return () => window.clearInterval(poll);
  }, [loadReviews]);

  const handleDeleteReview = async (id) => {
    try {
      await axios.delete(`${API}/${id}`);
      loadReviews();
    } catch (err) {
      setError("Failed to delete review.");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700 }}>Customer Reviews Moderation</h1>
        <p style={{ color: "#64748b", fontSize: "14px" }}>
          Review product ratings and customer feedback.
        </p>
      </div>
      {error && <p role="alert" style={{ color: "#b91c1c", fontSize: "13px" }}>{error}</p>}

      <div className="dashboard-panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Product</th>
              <th>Customer</th>
              <th>Rating</th>
              <th>Comment</th>
              <th>Date</th>
              <th>Moderation</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((rev) => (
              <tr key={rev.id}>
                <td>#{rev.id}</td>
                <td style={{ fontWeight: 600 }}>{rev.product_name}</td>
                <td>{rev.customer_name}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#eab308", fontWeight: 700 }}>
                    <Star size={14} fill="#eab308" /> {rev.rating} / 5
                  </span>
                </td>
                <td style={{ maxWidth: "300px" }}>{rev.comment || <i style={{ color: "#94a3b8" }}>No comment</i>}</td>
                <td style={{ fontSize: "12px", color: "#64748b" }}>{rev.created_at ? new Date(rev.created_at).toLocaleDateString() : "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleDeleteReview(rev.id)}
                    style={{ background: "#fee2e2", color: "#dc2626", border: "none", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600 }}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {reviews.length === 0 && (
          <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
            <MessageSquare size={36} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
            <p>No customer reviews submitted yet. When customers review products on the Storefront, they will appear here live.</p>
          </div>
        )}
      </div>
    </div>
  );
}
