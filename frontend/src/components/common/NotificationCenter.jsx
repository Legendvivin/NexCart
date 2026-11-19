import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Bell, CheckCheck } from "lucide-react";
import "./NotificationCenter.css";

const API = "http://127.0.0.1:8000";
const accountKey = (role) => role === "delivery" ? "delivery" : role;

export default function NotificationCenter({ role, userId: passedUserId }) {
  const key = accountKey(role);
  const token = localStorage.getItem(`nexcart_${key}_token`);
  const roleIdKey = role === "customer" ? "customer_id" : role === "vendor" ? "vendor_id" : role === "rider" ? "rider_id" : role === "delivery" ? "delivery_id" : "admin_id";
  const userId = passedUserId || localStorage.getItem(`nexcart_${key}_user_id`) || localStorage.getItem(`nexcart_${key}_id`) || localStorage.getItem(`nexcart_${roleIdKey}`);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const root = useRef(null);
  const seenIds = useRef(null);
  const [toast, setToast] = useState(null);
  const unread = items.filter((item) => !item.is_read).length;

  const refresh = useCallback(async () => {
    if (!token || !userId || sessionExpired) return;
    try {
      const response = await axios.get(`${API}/notifications`, {
        params: { role, user_id: userId },
        headers: { Authorization: `Bearer ${token}` },
      });
      const nextItems = Array.isArray(response.data) ? response.data : [];
      if (seenIds.current !== null) {
        const fresh = nextItems.find((item) => !seenIds.current.has(item.id));
        if (fresh) {
          setToast(`${fresh.title}: ${fresh.message}`);
          window.setTimeout(() => setToast(null), 3600);
        }
      }
      seenIds.current = new Set(nextItems.map((item) => item.id));
      setItems(nextItems);
      setSessionExpired(false);
    } catch (error) {
      if (error.response?.status === 401) {
        setItems([]);
        setSessionExpired(true);
      } else {
        console.warn("Could not load notifications", error);
      }
    }
  }, [token, userId, role, sessionExpired]);

  useEffect(() => {
    refresh();
    if (sessionExpired) return undefined;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, sessionExpired]);

  useEffect(() => {
    const closeOutside = (event) => { if (root.current && !root.current.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  const markRead = async (item) => {
    if (item.is_read) return;
    try {
      await axios.patch(`${API}/notifications/${item.id}/read`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setItems((all) => all.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
    } catch (error) { console.warn("Could not mark notification read", error); }
  };

  const markAllRead = async () => {
    try {
      await axios.patch(`${API}/notifications/read-all`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setItems((all) => all.map((entry) => ({ ...entry, is_read: true })));
    } catch (error) { console.warn("Could not mark all notifications read", error); }
  };

  return <div className="notification-center" ref={root}>
    {toast && <div className="notification-toast" role="status">{toast}</div>}
    <button className="notification-trigger" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) refresh(); }}>
      <Bell size={19}/>{unread > 0 && <span className="notification-count">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <section className="notification-popover" aria-label="Notifications">
      <div className="notification-popover-head"><div><strong>Notifications</strong><small>{unread ? `${unread} unread` : "You're all caught up"}</small></div>{unread > 0 && <button type="button" onClick={markAllRead}><CheckCheck size={14}/> Mark all read</button>}</div>
      <div className="notification-list">
        {sessionExpired ? <div className="notification-empty"><Bell size={21}/><span>Session expired</span><small>Sign in again to receive order updates.</small></div> : items.length === 0 ? <div className="notification-empty"><Bell size={21}/><span>No notifications yet</span><small>Updates will show here when something happens.</small></div> : items.map((item) => <button type="button" key={item.id} className={`notification-item${item.is_read ? " is-read" : ""}`} onClick={() => markRead(item)}>
          <span className="notification-dot"/><span className="notification-item-copy"><strong>{item.title}</strong><span>{item.message}</span><time>{item.created_at ? new Date(item.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}</time></span>
        </button>)}
      </div>
    </section>}
  </div>;
}
