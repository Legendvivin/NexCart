import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Store,
  Truck,
  Tags,
  Star,
  Settings,
} from "lucide-react";

const navItems = [
  { name: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
  { name: "Products", path: "/admin/products", icon: Package },
  { name: "Orders", path: "/admin/orders", icon: ShoppingBag },
  { name: "Categories", path: "/admin/categories", icon: Tags },
  { name: "Vendors", path: "/admin/vendors", icon: Store },
  { name: "Delivery Ops", path: "/admin/delivery", icon: Truck },
  { name: "Reviews", path: "/admin/reviews", icon: Star },
  { name: "Settings", path: "/admin/settings", icon: Settings },
];

export default function AdminSidebar() {
  return (
    <aside className="admin-sidebar">
      <div className="brand-logo">
        Nex<span>Cart</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              title={item.name}
              aria-label={item.name}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} />
              <span>{item.name}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
