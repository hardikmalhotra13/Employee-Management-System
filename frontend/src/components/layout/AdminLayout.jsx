import "./AdminShell.css";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar/Sidebar.jsx";
import Topbar from "./Topbar/Topbar.jsx";

function AdminLayout() {
  return (
    <div className="admin-shell">
      <Sidebar />
      <div className="admin-shell__content">
        <Topbar />
        <main className="admin-shell__page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;