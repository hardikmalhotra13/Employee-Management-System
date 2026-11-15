import { useState, useEffect } from "react";
import "./EmployeeForm.css";
import { User, Briefcase } from "lucide-react";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import { validateEmployee } from "../validations/employeeValidation.js";
import { listDepartments } from "../../../services/api/departmentApi.js";
import { listRoles } from "../../../services/api/roleApi.js";
import { listGrades } from "../../../services/api/gradeApi.js";
import { listShifts } from "../../../services/api/shiftApi.js";
import { listEmployees } from "../../../services/api/employeeApi.js";

const GENDER_OPTIONS = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
  { value: "Other", label: "Other" },
];

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "On Probation", label: "On Probation" },
  { value: "On Notice", label: "On Notice" },
  { value: "Inactive", label: "Inactive" },
];

function getSelectableOptions(masterList, idKey, nameKey, currentId) {
  return masterList
    .filter((item) => item.status === "Active" || String(item[idKey]) === String(currentId))
    .map((item) => ({ value: String(item[idKey]), label: item[nameKey] }));
}

function EmployeeForm({ initialData, onSubmit, onCancel }) {
  const isEditMode = Boolean(initialData);

  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [grades, setGrades] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [managerCandidates, setManagerCandidates] = useState([]);

  useEffect(() => {
    listDepartments({ page: 1, pageSize: 100 }).then((result) => setDepartments(result.records));
    listRoles({ page: 1, pageSize: 100 }).then((result) => setRoles(result.records));
    listGrades({ page: 1, pageSize: 100 }).then((result) => setGrades(result.records));
    listShifts({ page: 1, pageSize: 100 }).then((result) => setShifts(result.records));
    listEmployees({ page: 1, pageSize: 100 }).then((result) => setManagerCandidates(result.records));
  }, []);

  const [formData, setFormData] = useState({
    first_name: initialData?.first_name || "",
    last_name: initialData?.last_name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    address: initialData?.address || "",
    gender: initialData?.gender || "",
    date_of_birth: initialData?.date_of_birth || "",
    joining_date: initialData?.joining_date || "",
    department_id: initialData?.department_id ? String(initialData.department_id) : "",
    role_id: initialData?.role_id ? String(initialData.role_id) : "",
    grade_id: initialData?.grade_id ? String(initialData.grade_id) : "",
    shift_id: initialData?.shift_id ? String(initialData.shift_id) : "",
    reporting_manager_id: initialData?.reporting_manager_id ? String(initialData.reporting_manager_id) : "",
    status: initialData?.status || "Active",
  });

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSubmitting) return;

    const validationErrors = validateEmployee(formData, initialData?.employee_id);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length === 0) {
      setIsSubmitting(true);
      try {
        await onSubmit(formData);
      } finally {
        // On success the page navigates away, so this only matters when
        // the submit failed and the form stays up for another attempt.
        setIsSubmitting(false);
      }
    }
  };

  return (
    <form className="employee-form" onSubmit={handleSubmit}>
      {isEditMode && (
        <div className="employee-form__summary">
          <span className="employee-form__summary-label">Editing</span>
          <span className="employee-form__summary-name">
            {initialData.first_name} {initialData.last_name}
          </span>
          <span className="employee-form__summary-code">{initialData.employee_code}</span>
        </div>
      )}

      <div className="employee-form__section">
        <div className="employee-form__section-header">
          <span className="employee-form__section-icon">
            <User size={16} />
          </span>
          <div>
            <h2 className="employee-form__section-title">Personal information</h2>
            <p className="employee-form__section-subtitle">Name, contact details, and address</p>
          </div>
        </div>

        <div className="employee-form__grid">
          <FormInput
            label="First Name"
            name="first_name"
            value={formData.first_name}
            onChange={(value) => handleChange("first_name", value)}
            error={errors.first_name}
            required
          />

          <FormInput
            label="Last Name"
            name="last_name"
            value={formData.last_name}
            onChange={(value) => handleChange("last_name", value)}
            error={errors.last_name}
            required
          />

          <FormInput
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={(value) => handleChange("email", value)}
            error={errors.email}
            required
          />

          <FormInput
            label="Phone"
            name="phone"
            value={formData.phone}
            onChange={(value) => handleChange("phone", value)}
            error={errors.phone}
            required
          />

          <FormInput
            label="Gender"
            name="gender"
            type="select"
            value={formData.gender}
            onChange={(value) => handleChange("gender", value)}
            options={GENDER_OPTIONS}
            error={errors.gender}
            required
          />

          <FormInput
            label="Date of Birth"
            name="date_of_birth"
            type="date"
            value={formData.date_of_birth}
            onChange={(value) => handleChange("date_of_birth", value)}
            error={errors.date_of_birth}
            required
          />

          <div className="employee-form__full">
            <FormInput
              label="Address"
              name="address"
              value={formData.address}
              onChange={(value) => handleChange("address", value)}
              error={errors.address}
            />
          </div>
        </div>
      </div>

      <div className="employee-form__section">
        <div className="employee-form__section-header">
          <span className="employee-form__section-icon">
            <Briefcase size={16} />
          </span>
          <div>
            <h2 className="employee-form__section-title">Employment information</h2>
            <p className="employee-form__section-subtitle">Department, role, and reporting structure</p>
          </div>
        </div>

        <div className="employee-form__grid">
          <FormInput
            label="Department"
            name="department_id"
            type="select"
            value={formData.department_id}
            onChange={(value) => handleChange("department_id", value)}
            options={getSelectableOptions(departments, "department_id", "department_name", initialData?.department_id)}
            error={errors.department_id}
            required
          />

          <FormInput
            label="Role"
            name="role_id"
            type="select"
            value={formData.role_id}
            onChange={(value) => handleChange("role_id", value)}
            options={getSelectableOptions(roles, "role_id", "role_name", initialData?.role_id)}
            error={errors.role_id}
            required
          />

          <FormInput
            label="Grade"
            name="grade_id"
            type="select"
            value={formData.grade_id}
            onChange={(value) => handleChange("grade_id", value)}
            options={getSelectableOptions(grades, "grade_id", "grade_name", initialData?.grade_id)}
            error={errors.grade_id}
            required
          />

          <FormInput
            label="Shift"
            name="shift_id"
            type="select"
            value={formData.shift_id}
            onChange={(value) => handleChange("shift_id", value)}
            options={getSelectableOptions(shifts, "shift_id", "shift_name", initialData?.shift_id)}
            error={errors.shift_id}
            required
          />

          <FormInput
            label="Joining Date"
            name="joining_date"
            type="date"
            value={formData.joining_date}
            onChange={(value) => handleChange("joining_date", value)}
            error={errors.joining_date}
            required
          />

          <FormInput
            label="Status"
            name="status"
            type="select"
            value={formData.status}
            onChange={(value) => handleChange("status", value)}
            options={STATUS_OPTIONS}
            error={errors.status}
            required
          />

          <FormInput
            label="Reporting Manager"
            name="reporting_manager_id"
            type="select"
            value={formData.reporting_manager_id}
            onChange={(value) => handleChange("reporting_manager_id", value)}
            options={managerCandidates
              .filter((emp) => !initialData || String(emp.employee_id) !== String(initialData.employee_id))
              .map((emp) => ({
                value: String(emp.employee_id),
                label: `${emp.first_name} ${emp.last_name} (${emp.employee_code})`,
              }))}
            error={errors.reporting_manager_id}
          />
        </div>
      </div>

      <div className="employee-form__actions">
        <button type="button" className="employee-form__cancel" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </button>
        <button type="submit" className="employee-form__submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : isEditMode ? "Save Changes" : "Create Employee"}
        </button>
      </div>
    </form>
  );
}

export default EmployeeForm;