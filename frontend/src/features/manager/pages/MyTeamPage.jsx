import "./MyTeamPage.css";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import { getMyTeam } from "../../../services/api/managerApi.js";

function MyTeamPage() {
  const navigate = useNavigate();

  const [team, setTeam] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setLoadError("");

    getMyTeam()
      .then((data) => setTeam(data))
      .catch(() => setLoadError("Failed to load your team. Please try again."))
      .finally(() => setIsLoading(false));
  }, []);

  const columns = [
    { key: "employee_code", label: "Employee Code" },
    {
      key: "name",
      label: "Name",
      render: (row) => `${row.first_name} ${row.last_name}`,
    },
    { key: "department_name", label: "Department" },
    { key: "role_name", label: "Role" },
    { key: "shift_name", label: "Shift" },
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
          className="my-team-page__action-button"
          onClick={() => navigate(employeeRoutePaths.TEAM_MEMBER_VIEW(row.employee_id))}
        >
          <Eye size={16} />
        </button>
      ),
    },
  ];

  return (
    <div className="my-team-page">
      <PageHeader title="My Team" subtitle="Employees who report to you" />

      {loadError && <p className="my-team-page__error">{loadError}</p>}

      <div className="my-team-page__table-card">
        <DataTable
          columns={columns}
          rows={team}
          isLoading={isLoading}
          emptyMessage="You don't have any direct reports."
        />
      </div>
    </div>
  );
}

export default MyTeamPage;