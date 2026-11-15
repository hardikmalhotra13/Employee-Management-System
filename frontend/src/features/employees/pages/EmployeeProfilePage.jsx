import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./EmployeeProfilePage.css";
import { Pencil, ArrowLeft, User, Briefcase, IdCard } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import routePaths from "../../../routes/routePaths.js";
import { getEmployee } from "../../../services/api/employeeApi.js";
import EmployeeDocuments from "../components/EmployeeDocuments.jsx";
import EmployeeDirectReports from "../components/EmployeeDirectReports.jsx";
import EmployeeOnboarding from "../components/EmployeeOnboarding.jsx";
import EmployeeOffboarding from "../components/EmployeeOffboarding.jsx";
import EmployeePerformance from "../components/EmployeePerformance.jsx";
import EmployeeTraining from "../components/EmployeeTraining.jsx";

const pageStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

function formatDate(value) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function EmployeeProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { admin } = useAuth();
  const canUpdate = hasPermission(admin, "employees.update");

  const [employee, setEmployee] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const fetchEmployee = () => {
    setIsLoading(true);
    setLoadError("");

    return getEmployee(id)
      .then((data) => setEmployee(data))
      .catch(() => setLoadError("Employee not found"))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchEmployee();
  }, [id]);

  if (isLoading) {
    return (
      <div style={pageStyle} className="employee-profile-page">
        <PageHeader title="Employee Profile" subtitle="Loading employee details..." />
      </div>
    );
  }

  if (loadError || !employee) {
    return (
      <div style={pageStyle} className="employee-profile-page">
        <PageHeader title="Employee not found" subtitle="This employee record does not exist" />
      </div>
    );
  }

  return (
    <div style={pageStyle} className="employee-profile-page">
      <div className="employee-profile-page__toprow">
        <button
          type="button"
          className="employee-profile-page__back-button"
          onClick={() => navigate(routePaths.EMPLOYEES)}
        >
          <ArrowLeft size={15} />
          Back to Employees
        </button>
        {canUpdate && (
          <button
            type="button"
            className="employee-profile-page__edit-button"
            onClick={() => navigate(routePaths.EMPLOYEE_EDIT(employee.employee_id))}
          >
            <Pencil size={15} />
            Edit Employee
          </button>
        )}
      </div>

      <div className="employee-profile-page__hero">
        <div className="employee-profile-page__hero-icon">
          <User size={26} />
        </div>

        <div className="employee-profile-page__hero-info">
          <div className="employee-profile-page__hero-name-row">
            <h1 className="employee-profile-page__hero-name">
              {employee.first_name} {employee.last_name}
            </h1>
            <StatusBadge status={employee.status} />
            {Boolean(employee.is_archived) && (
              <span className="employee-profile-page__archived-badge">Archived</span>
            )}
          </div>
          <p className="employee-profile-page__hero-meta">
            <IdCard size={13} /> {employee.employee_code}
            <span className="employee-profile-page__hero-dot" />
            {employee.role_name}
            <span className="employee-profile-page__hero-dot" />
            {employee.department_name}
          </p>
        </div>
      </div>

      <div className="employee-profile-page__chip-row">
        <div className="employee-profile-page__chip">
          <span className="employee-profile-page__chip-label">Department</span>
          <span className="employee-profile-page__chip-value">{employee.department_name}</span>
        </div>
        <div className="employee-profile-page__chip">
          <span className="employee-profile-page__chip-label">Role</span>
          <span className="employee-profile-page__chip-value">{employee.role_name}</span>
        </div>
        <div className="employee-profile-page__chip">
          <span className="employee-profile-page__chip-label">Grade</span>
          <span className="employee-profile-page__chip-value">{employee.grade_name}</span>
        </div>
        <div className="employee-profile-page__chip">
          <span className="employee-profile-page__chip-label">Shift</span>
          <span className="employee-profile-page__chip-value">{employee.shift_name}</span>
        </div>
      </div>

      <div className="employee-profile-page__two-col">
        <div className="employee-profile-page__card">
          <div className="employee-profile-page__section-header">
            <span className="employee-profile-page__section-icon">
              <User size={16} />
            </span>
            <h2 className="employee-profile-page__section-title">Personal information</h2>
          </div>
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

        <div className="employee-profile-page__card">
          <div className="employee-profile-page__section-header">
            <span className="employee-profile-page__section-icon employee-profile-page__section-icon--purple">
              <Briefcase size={16} />
            </span>
            <h2 className="employee-profile-page__section-title">Employment information</h2>
          </div>
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

      <EmployeeDirectReports employeeId={employee.employee_id} />

      <EmployeeDocuments employeeId={employee.employee_id} />

      <EmployeePerformance employeeId={employee.employee_id} />

      <EmployeeTraining employeeId={employee.employee_id} />

      <EmployeeOnboarding employeeId={employee.employee_id} onCompleted={fetchEmployee} />

      <EmployeeOffboarding
        employeeId={employee.employee_id}
        isEmployeeArchived={Boolean(employee.is_archived)}
        onCompleted={fetchEmployee}
      />
    </div>
  );
}

export default EmployeeProfilePage;