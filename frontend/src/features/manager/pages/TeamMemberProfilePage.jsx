import "../../employees/pages/EmployeeProfilePage.css";
import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import { getTeamMember } from "../../../services/api/managerApi.js";

const pageStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
};

function formatDate(value) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function TeamMemberProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [employee, setEmployee] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setLoadError("");

    getTeamMember(id)
      .then((data) => setEmployee(data))
      .catch(() => setLoadError("Employee not found"))
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) {
    return (
      <div style={pageStyle} className="employee-profile-page">
        <PageHeader title="Team Member" subtitle="Loading employee details..." />
      </div>
    );
  }

  if (loadError || !employee) {
    return (
      <div style={pageStyle} className="employee-profile-page">
        <PageHeader
          title="Employee not found"
          subtitle="This employee is not part of your team"
          actions={
            <button
              type="button"
              className="employee-profile-page__back-button"
              onClick={() => navigate(employeeRoutePaths.TEAM)}
            >
              <ArrowLeft size={16} />
              Back to My Team
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div style={pageStyle} className="employee-profile-page">
      <PageHeader
        title={`${employee.first_name} ${employee.last_name}`}
        subtitle={`Employee Code: ${employee.employee_code}`}
        actions={
          <button
            type="button"
            className="employee-profile-page__back-button"
            onClick={() => navigate(employeeRoutePaths.TEAM)}
          >
            <ArrowLeft size={16} />
            Back to My Team
          </button>
        }
      />

      <div className="employee-profile-page__card">
        <div className="employee-profile-page__status-row">
          <StatusBadge status={employee.status} />
        </div>

        <div className="employee-profile-page__section">
          <h2 className="employee-profile-page__section-title">Personal Information</h2>
          <div className="employee-profile-page__grid">
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Email</p>
              <p className="employee-profile-page__value">{employee.email}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Phone</p>
              <p className="employee-profile-page__value">{employee.phone}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Gender</p>
              <p className="employee-profile-page__value">{employee.gender}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Date of Birth</p>
              <p className="employee-profile-page__value">{formatDate(employee.date_of_birth)}</p>
            </div>
            <div className="employee-profile-page__field employee-profile-page__field--full">
              <p className="employee-profile-page__label">Address</p>
              <p className="employee-profile-page__value">{employee.address || "-"}</p>
            </div>
          </div>
        </div>

        <div className="employee-profile-page__section">
          <h2 className="employee-profile-page__section-title">Employment Information</h2>
          <div className="employee-profile-page__grid">
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Department</p>
              <p className="employee-profile-page__value">{employee.department_name}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Role</p>
              <p className="employee-profile-page__value">{employee.role_name}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Grade</p>
              <p className="employee-profile-page__value">{employee.grade_name}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Shift</p>
              <p className="employee-profile-page__value">{employee.shift_name}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Joining Date</p>
              <p className="employee-profile-page__value">{formatDate(employee.joining_date)}</p>
            </div>
            <div className="employee-profile-page__field">
              <p className="employee-profile-page__label">Reports To</p>
              <p className="employee-profile-page__value">
                {employee.manager_first_name
                  ? `${employee.manager_first_name} ${employee.manager_last_name}`
                  : "-"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TeamMemberProfilePage;