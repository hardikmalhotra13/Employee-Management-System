import "./EmployeeFilters.css";

const STATUS_OPTIONS = ["Active", "On Probation", "On Notice", "Inactive"];

function EmployeeFilters({
  departments,
  roles,
  department,
  role,
  status,
  onDepartmentChange,
  onRoleChange,
  onStatusChange,
}) {
  return (
    <div className="employee-filters">
      <select
        value={department}
        onChange={(e) => onDepartmentChange(e.target.value)}
        className="employee-filters__select"
      >
        <option value="">All departments</option>
        {departments.map((dept) => (
          <option key={dept.department_id} value={dept.department_id}>
            {dept.department_name}
          </option>
        ))}
      </select>

      <select
        value={role}
        onChange={(e) => onRoleChange(e.target.value)}
        className="employee-filters__select"
      >
        <option value="">All roles</option>
        {roles.map((r) => (
          <option key={r.role_id} value={r.role_id}>
            {r.role_name}
          </option>
        ))}
      </select>

      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="employee-filters__select"
      >
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

export default EmployeeFilters;