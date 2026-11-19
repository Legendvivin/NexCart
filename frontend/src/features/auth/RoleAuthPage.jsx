import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import "./Auth.css";

const API = "http://127.0.0.1:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const settings = {
  admin: { title: "NexCart Control", eyebrow: "ADMINISTRATOR", desc: "Sign in to manage marketplace operations and accounts.", accent: "#4f46e5", login: "/admin/login", register: "/admin/register", home: "/admin", links: [["Customer shop", "/login"], ["Vendor portal", "/vendor/login"]] },
  customer: { title: "Shop with NexCart", eyebrow: "CUSTOMER ACCOUNT", desc: "Discover local stores and keep every order in one place.", accent: "#6d28d9", login: "/login", register: "/register", home: "/store", links: [["Sell on NexCart", "/vendor/login"], ["Delivery partner", "/rider/login"]] },
  vendor: { title: "Your store, growing", eyebrow: "SELLER CENTER", desc: "Sign in to manage your products, orders, and payouts.", accent: "#059669", login: "/vendor/login", register: "/vendor/register", home: "/vendor/dashboard", links: [["Customer shop", "/login"], ["Delivery partner", "/rider/login"]] },
  rider: { title: "Ready for your next delivery?", eyebrow: "DELIVERY PARTNER", desc: "Access your delivery assignments and earnings.", accent: "#d97706", login: "/rider/login", register: "/rider/register", home: "/rider/dashboard", links: [["Customer shop", "/login"], ["Hub manager", "/delivery/login"]] },
  delivery: { title: "Delivery operations", eyebrow: "LOGISTICS HUB", desc: "Coordinate dispatch and keep deliveries moving.", accent: "#2563eb", login: "/delivery/login", register: "/delivery/register", home: "/delivery/dashboard", links: [["Delivery partner", "/rider/login"], ["Vendor", "/vendor/login"]] },
};

export default function RoleAuthPage({ role, initialRegister = false }) {
  const config = settings[role];
  const [register, setRegister] = useState(initialRegister);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [registrationKey, setRegistrationKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const googleButton = useRef(null);
  const registrationKeyRef = useRef(registrationKey);
  const navigate = useNavigate();
  registrationKeyRef.current = registrationKey;

  useEffect(() => setRegister(initialRegister), [initialRegister]);

  useEffect(() => {
    if (role !== "customer" || !GOOGLE_CLIENT_ID || !googleButton.current) return undefined;
    let cancelled = false;
    const renderGoogleButton = () => {
      if (cancelled || !window.google?.accounts?.id || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError(""); setLoading(true);
          try {
            const response = await axios.post(`${API}/auth/google`, { credential, role, store_name: storeName, registration_key: registrationKeyRef.current });
            if ((role === "rider" || role === "vendor") && response.data.application_status) {
              setNotice(response.data.message || "Your application is awaiting admin approval.");
              setRegister(false);
            } else saveSession(response.data);
          } catch (err) {
            setError(err.response?.data?.detail || "Google sign-in failed.");
          } finally { setLoading(false); }
        },
      });
      googleButton.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButton.current, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 360 });
    };
    if (window.google?.accounts?.id) renderGoogleButton();
    else {
      let script = document.querySelector('script[data-google-identity]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true; script.defer = true; script.dataset.googleIdentity = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderGoogleButton);
    }
    return () => { cancelled = true; };
    // Google button is recreated when role or store name changes.
  }, [role]);

  function saveSession(data) {
    const key = role === "delivery" ? "delivery" : role;
    localStorage.setItem(`nexcart_${key}_token`, data.access_token);
    localStorage.setItem(`nexcart_${key}_name`, data.full_name || "");
    if (data.email) localStorage.setItem(`nexcart_${key}_email`, data.email);
    const resolvedUserId = data.user_id || data.customer_id || data.vendor_id || data.rider_id || data.delivery_id;
    if (resolvedUserId) localStorage.setItem(`nexcart_${key}_user_id`, resolvedUserId);
    if (role === "admin" && resolvedUserId) localStorage.setItem("nexcart_admin_id", resolvedUserId);
    if (role === "customer") {
      localStorage.setItem("nexcart_customer_id", data.user_id || data.customer_id);
      if (data.email) localStorage.setItem("nexcart_customer_email", data.email);
    }
    if (role === "vendor") {
      localStorage.setItem("nexcart_vendor_id", data.user_id || data.vendor_id);
      localStorage.setItem("nexcart_store_name", data.store_name || "");
    }
    if (role === "rider") localStorage.setItem("nexcart_rider_id", data.user_id || data.rider_id);
    navigate(data.next || config.home);
  }

  async function submit(event) {
    event.preventDefault(); setError(""); setNotice(""); setLoading(true);
    try {
      const endpoint = register ? `/auth/${role}/register` : "/auth/login";
      const payload = register
        ? { full_name: fullName, email, password, phone, store_name: storeName, registration_key: registrationKey }
        : { email, password, role };
      const { data } = await axios.post(`${API}${endpoint}`, payload);
      if (role === "rider" && register && data.application_status) {
        setNotice(data.message || "Your application is awaiting admin approval.");
        setPassword("");
        setRegister(false);
        return;
      }
      if (register) {
        setNotice(role === "vendor"
          ? "Your vendor account was created. Admin approval is required before you can sign in."
          : "Your account was created. Sign in to continue.");
        setPassword("");
        setRegister(false);
        return;
      }
      saveSession(data);
    } catch (err) {
      setError(err.response?.data?.detail || "We couldn't complete that request. Please try again.");
    } finally { setLoading(false); }
  }

  return <main className="role-auth" style={{ "--auth-accent": config.accent }}>
    <div className="role-auth-art" aria-hidden="true"><div className="auth-art-orb auth-art-orb-one"/><div className="auth-art-orb auth-art-orb-two"/><div className="auth-art-copy"><span className="auth-brand-mark">N</span><p>One marketplace.<br/>More possibilities.</p><span>Local businesses, delivered to your door.</span></div></div>
    <section className="role-auth-panel">
      <div className="role-auth-card">
        <Link className="auth-wordmark" to="/">NexCart<span>.</span></Link>
        <span className="auth-eyebrow">{config.eyebrow}</span>
        <h1>{register ? `Create your ${role === "delivery" ? "hub" : role} account` : config.title}</h1>
        <p className="role-auth-description">{register ? `Join NexCart as a ${role === "delivery" ? "hub manager" : role}. It only takes a minute.` : config.desc}</p>

        {error && <div className="role-auth-error" role="alert">{error}</div>}
        {notice && <div className="role-auth-notice" role="status">{notice}</div>}
        {role === "customer" && GOOGLE_CLIENT_ID && <><div className="google-button-wrap"><div ref={googleButton}/></div><div className="auth-divider"><span>or continue with email</span></div></>}

        <form onSubmit={submit} className="role-auth-form">
          {register && <>
            <label>Full name<input autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} required placeholder="Your name"/></label>
            {role === "vendor" && <label>Store name<input value={storeName} onChange={e => setStoreName(e.target.value)} required placeholder="Your shop name"/></label>}
            {role === "admin" && <label>Admin setup key<input type="password" autoComplete="off" value={registrationKey} onChange={e => setRegistrationKey(e.target.value)} required placeholder="Provided by your system owner"/></label>}
            {(role === "customer" || role === "rider") && <label>Phone number<input autoComplete="tel" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required placeholder="Your phone number"/></label>}
          </>}
          <label>Email address<input autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"/></label>
          <label>Password<input autoComplete={register ? "new-password" : "current-password"} type="password" minLength={register ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} required placeholder={register ? "At least 8 characters" : "Enter your password"}/></label>
          <button className="role-auth-submit" type="submit" disabled={loading}>{loading ? "Please wait…" : register ? "Create account" : "Sign in"}<span aria-hidden="true">→</span></button>
        </form>

        <p className="role-auth-switch">{register ? "Already have an account?" : "New to NexCart?"} <Link to={register ? config.login : config.register}>{register ? "Sign in" : "Create an account"}</Link></p>
        <nav className="role-auth-links" aria-label="Other account portals">{config.links.map(([label, path]) => <Link to={path} key={path}>{label}</Link>)}</nav>
        {role === "admin" && register && <p className="google-setup-note">Admin creation requires the private setup key configured by the system owner.</p>}
        {role === "customer" && !GOOGLE_CLIENT_ID && <p className="google-setup-note">Google sign-in will appear once it is configured for this app.</p>}
      </div>
      <footer className="role-auth-footer">© {new Date().getFullYear()} NexCart · Secure account access</footer>
    </section>
  </main>;
}
