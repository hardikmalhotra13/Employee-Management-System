import "./EmployeeDirectReports.css";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Eye, UsersRound } from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import routePaths from "../../../routes/routePaths.js";
import { getDirectReports } from "../../../services/api/employeeApi.js";

function getInitials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

function EmployeeDirectReports({ employeeId }) {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setLoadError("");

    getDirectReports(employeeId)
      .then((data) => setReports(data))
      .catch(() => setLoadError("Failed to load direct reports. Please try again."))
      .finally(() => setIsLoading(false));
  }, [employeeId]);

  const columns = [
    {
      key: "employee",
      label: "Employee",
      render: (row) => (
        <div className="employee-direct-reports__employee-cell">
          <span className="employee-direct-reports__avatar">
            {getInitials(row.first_name, row.last_name)}
          </span>
          <div className="employee-direct-reports__employee-info">
            <span className="employee-direct-reports__employee-name">
              {row.first_name} {row.last_name}
            </span>
            <span className="employee-direct-reports__employee-code">{row.employee_code}</span>
          </div>
        </div>
      ),
    },
    { key: "department_name", label: "Department" },
    { key: "role_name", label: "Role" },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <button
          type="button"
          className="employee-direct-reports__action-button employee-direct-reports__action-button--view"
          onClick={() => navigate(routePaths.EMPLOYEE_VIEW(row.employee_id))}
          aria-label="View employee"
          title="View"
        >
          <Eye size={16} />
        </button>
      ),
    },
  ];

  return (
    <div className="employee-direct-reports">
      <div className="employee-direct-reports__header">
        <div className="employee-direct-reports__heading">
          <span className="employee-direct-reports__icon">
            <Users size={16} />
          </span>
          <div>
            <p className="employee-direct-reports__title">Direct Reports ({reports.length})</p>
            <p className="employee-direct-reports__subtitle">
              Employees who report to this employee
            </p>
          </div>
        </div>
      </div>

      {loadError && <p className="employee-direct-reports__error">{loadError}</p>}

      {!isLoading && !loadError && reports.length === 0 ? (
        <div className="employee-direct-reports__empty-state">
          <span className="employee-direct-reports__empty-icon">
            <UsersRound size={22} />
          </span>
          <p className="employee-direct-reports__empty-title">No direct reports</p>
          <p className="employee-direct-reports__empty-message">
            Employees who report to this person will show up here.
          </p>
        </div>
      ) : (
        <div className="employee-direct-reports__table-card">
          <DataTable
            columns={columns}
            rows={reports}
            isLoading={isLoading}
            emptyMessage="No direct reports"
          />
        </div>
      )}
    </div>
  );
}

export default EmployeeDirectReports;