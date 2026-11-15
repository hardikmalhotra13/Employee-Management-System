import "./EmployeeShell.css";
import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import EmployeeSidebar from "./EmployeeSidebar/EmployeeSidebar.jsx";
import EmployeeTopbar from "./EmployeeTopbar/EmployeeTopbar.jsx";
import { getMyTeam } from "../../services/api/managerApi.js";

function EmployeeLayout() {
  const [hasTeam, setHasTeam] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    // Whether "My Team" and the Team-* nav items show is based purely on
    // whether this employee actually has direct reports today - fetched
    // once here rather than inferred from role/title.
    getMyTeam()
      .then((team) => setHasTeam((team || []).length > 0))
      .catch(() => setHasTeam(false));
  }, []);

  return (
    <div className="employee-shell">
      <EmployeeSidebar hasTeam={hasTeam} isOpen={isMobileNavOpen} onNavigate={() => setIsMobileNavOpen(false)} />

      {isMobileNavOpen && (
        <div className="employee-shell__backdrop" onClick={() => setIsMobileNavOpen(false)} />
      )}

      <div className="employee-shell__content">
        <EmployeeTopbar onMenuClick={() => setIsMobileNavOpen(true)} />
        <main className="employee-shell__page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default EmployeeLayout;