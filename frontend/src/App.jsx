import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import AdminLayout from "./layouts/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ProductsPage from "./pages/admin/ProductsPage";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminVendors from "./pages/admin/AdminVendors";
import AdminDeliveryOperations from "./pages/admin/AdminDeliveryOperations";
import AdminReviews from "./pages/admin/AdminReviews";
import AdminSettings from "./pages/admin/AdminSettings";

import AdminLogin from "./features/auth/AdminLogin";
import VendorLogin from "./features/auth/VendorLogin";
import CustomerLogin from "./features/auth/CustomerLogin";
import DeliveryManagerLogin from "./features/auth/DeliveryManagerLogin";
import RiderLogin from "./features/auth/RiderLogin";
import RoleAuthPage from "./features/auth/RoleAuthPage";
import VendorDashboard from "./pages/vendor/VendorDashboard";
import Storefront from "./pages/customer/Storefront";
import DeliveryDashboard from "./pages/delivery-manager/DeliveryManagerDashboard";
import RiderDashboard from "./pages/rider/RiderDashboard";

function RequireRole({ role, children }) {
  const tokenKey = role === "delivery" ? "delivery" : role;
  const token = localStorage.getItem(`nexcart_${tokenKey}_token`);
  let tokenRole = "";
  let tokenExpired = true;
  try {
    if (token) {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      tokenRole = payload.role || "";
      tokenExpired = !payload.exp || payload.exp * 1000 <= Date.now();
    }
  } catch { /* An invalid or expired token returns to the role's sign-in page. */ }
  if (!token || tokenExpired || (role === "delivery" ? !["delivery", "admin"].includes(tokenRole) : tokenRole !== role)) {
    const loginPath = role === "customer" ? "/login" : role === "rider" ? "/rider/login" : `/${role}/login`;
    return <Navigate to={loginPath} replace />;
  }
  return children;
}

// Automatically routes each localhost port to its matching login/portal
function PortDefaultRedirect() {
  const port = window.location.port;
  if (port === "5174") return <Navigate to="/admin/login" replace />;
  if (port === "5175") return <Navigate to="/vendor/login" replace />;
  if (port === "5176") return <Navigate to="/delivery/login" replace />;
  return <Navigate to="/login" replace />;
}

function PortalDocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const port = window.location.port;
    let portal = "Customer Store";
    if (pathname.startsWith("/admin")) portal = "Admin Portal";
    else if (pathname.startsWith("/vendor")) portal = "Vendor Portal";
    else if (pathname.startsWith("/rider") || pathname.startsWith("/delivery")) portal = "Rider & Delivery Portal";
    else if (pathname === "/" && port === "5174") portal = "Admin Portal";
    else if (pathname === "/" && port === "5175") portal = "Vendor Portal";
    else if (pathname === "/" && port === "5176") portal = "Rider & Delivery Portal";
    document.title = `NexCart | ${portal}`;
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <PortalDocumentTitle />
      <Routes>
        <Route path="/" element={<PortDefaultRedirect />} />

        {/* Separate Role Logins */}
        <Route path="/login" element={<CustomerLogin />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/register" element={<RoleAuthPage role="admin" initialRegister />} />
        <Route path="/vendor/login" element={<VendorLogin />} />
        <Route path="/delivery/login" element={<DeliveryManagerLogin />} />
        <Route path="/rider/login" element={<RiderLogin />} />
        <Route path="/register" element={<RoleAuthPage role="customer" initialRegister />} />
        <Route path="/vendor/register" element={<RoleAuthPage role="vendor" initialRegister />} />
        <Route path="/rider/register" element={<RoleAuthPage role="rider" initialRegister />} />
        <Route path="/delivery/register" element={<RoleAuthPage role="delivery" initialRegister />} />

        {/* Customer Storefront */}
        <Route path="/store" element={<Storefront />} />

        {/* Delivery Operations Portal */}
        <Route path="/delivery/dashboard" element={<RequireRole role="delivery"><DeliveryDashboard /></RequireRole>} />
        <Route
          path="/rider/dashboard"
          element={
            <RequireRole role="rider">
              <RiderDashboard />
            </RequireRole>
          }
        />

        {/* Protected Admin Portal */}
        <Route
          path="/admin"
          element={
            <RequireRole role="admin">
              <AdminLayout />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="vendors" element={<AdminVendors />} />
          <Route path="delivery" element={<AdminDeliveryOperations />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="notifications" element={<Navigate to="dashboard" replace />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>

        {/* Protected Vendor Portal */}
        <Route
          path="/vendor/dashboard"
          element={
            <RequireRole role="vendor">
              <VendorDashboard />
            </RequireRole>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
