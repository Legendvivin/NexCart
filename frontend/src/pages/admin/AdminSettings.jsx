import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { KeyRound, LockKeyhole, Save, ShieldCheck, UserRound } from "lucide-react";

const API = "http://127.0.0.1:8000/admin/settings";

export default function AdminSettings() {
  const token = localStorage.getItem("nexcart_admin_token");
  const [profile, setProfile] = useState({ full_name: "", email: "", phone: "", id: "" });
  const [passwords, setPasswords] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/admin-profile`, { headers: { Authorization: `Bearer ${token}` } });
      setProfile(response.data);
      localStorage.setItem("nexcart_admin_name", response.data.full_name || "Super Admin");
      setError("");
    } catch (loadError) {
      setError(loadError.response?.data?.detail || "Admin profile could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    setError("");
    setMessage("");
    try {
      const response = await axios.put(`${API}/admin-profile`, {
        full_name: profile.full_name,
        phone: profile.phone,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setProfile((current) => ({ ...current, ...response.data }));
      localStorage.setItem("nexcart_admin_name", response.data.full_name);
      window.dispatchEvent(new Event("nexcart-admin-profile-updated"));
      setMessage("Admin profile saved.");
    } catch (saveError) {
      setError(saveError.response?.data?.detail || "Admin profile could not be saved.");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (passwords.new_password !== passwords.confirm_password) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await axios.patch(`${API}/admin-password`, {
        current_password: passwords.current_password,
        new_password: passwords.new_password,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setPasswords({ current_password: "", new_password: "", confirm_password: "" });
      setMessage("Admin password updated.");
    } catch (saveError) {
      setError(saveError.response?.data?.detail || "Admin password could not be updated.");
    } finally {
      setSavingPassword(false);
    }
  };

  return <div className="admin-settings-page">
    <section className="admin-settings-hero">
      <div className="admin-settings-hero-icon"><ShieldCheck size={21} /></div>
      <div><span>ADMIN WORKSPACE</span><h1>Admin account settings</h1><p>Manage your administrator profile and sign-in security.</p></div>
    </section>
    {error && <p className="admin-settings-alert is-error" role="alert">{error}</p>}
    {message && <p className="admin-settings-alert is-success" role="status">{message}</p>}
    {loading ? <div className="dashboard-panel admin-settings-loading">Loading admin account…</div> : <div className="admin-settings-grid">
      <form className="dashboard-panel admin-settings-card" onSubmit={saveProfile}>
        <div className="admin-settings-card-title"><span><UserRound size={17} /></span><div><h2>Admin profile</h2><p>Your account details for this workspace.</p></div></div>
        <label>Full name<input required minLength={2} maxLength={120} value={profile.full_name} onChange={(event) => setProfile((current) => ({ ...current, full_name: event.target.value }))} /></label>
        <label>Email address<input value={profile.email} readOnly aria-readonly="true" /></label>
        <label>Mobile number<input type="tel" maxLength={30} value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} placeholder="Add a contact number" /></label>
        <div className="admin-settings-account-id">Administrator ID <strong>#{profile.id}</strong></div>
        <button type="submit" disabled={savingProfile}><Save size={16} />{savingProfile ? "Saving…" : "Save profile"}</button>
      </form>

      <form className="dashboard-panel admin-settings-card" onSubmit={savePassword}>
        <div className="admin-settings-card-title"><span><LockKeyhole size={17} /></span><div><h2>Sign-in security</h2><p>Change the password used for your admin account.</p></div></div>
        <label>Current password<input type="password" autoComplete="current-password" required value={passwords.current_password} onChange={(event) => setPasswords((current) => ({ ...current, current_password: event.target.value }))} /></label>
        <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={passwords.new_password} onChange={(event) => setPasswords((current) => ({ ...current, new_password: event.target.value }))} /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={passwords.confirm_password} onChange={(event) => setPasswords((current) => ({ ...current, confirm_password: event.target.value }))} /></label>
        <p className="admin-settings-password-hint"><KeyRound size={14} /> Use at least 8 characters.</p>
        <button type="submit" disabled={savingPassword}><LockKeyhole size={16} />{savingPassword ? "Updating…" : "Update password"}</button>
      </form>
    </div>}
  </div>;
}
