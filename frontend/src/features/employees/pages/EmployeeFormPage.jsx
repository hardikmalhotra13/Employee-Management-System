import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./EmployeeFormPage.css";
import PageHeader from "../../../components/common/PageHeader.jsx";
import EmployeeForm from "../components/EmployeeForm.jsx";
import routePaths from "../../../routes/routePaths.js";
import { getEmployee, createEmployee, updateEmployee } from "../../../services/api/employeeApi.js";

const pageStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
};

function EmployeeFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();

  const isEditMode = Boolean(id);

  const [employee, setEmployee] = useState(null);
  const [isLoading, setIsLoading] = useState(isEditMode);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!isEditMode) return;

    setIsLoading(true);
    getEmployee(id)
      .then((data) => setEmployee(data))
      .catch(() => setLoadError("Employee not found"))
      .finally(() => setIsLoading(false));
  }, [id]);

  const handleSubmit = async (formData) => {
    setSubmitError("");

    try {
      if (isEditMode) {
        await updateEmployee(id, formData);
        navigate(routePaths.EMPLOYEES, { state: { successMessage: "Employee updated successfully" } });
      } else {
        await createEmployee(formData);
        navigate(routePaths.EMPLOYEES, { state: { successMessage: "Employee created successfully" } });
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleCancel = () => {
    navigate(routePaths.EMPLOYEES);
  };

  if (isEditMode && isLoading) {
    return (
      <div style={pageStyle} className="employee-form-page">
        <PageHeader title="Edit Employee" subtitle="Loading employee details..." />
      </div>
    );
  }

  if (isEditMode && loadError) {
    return (
      <div style={pageStyle} className="employee-form-page">
        <PageHeader title="Employee not found" subtitle="This employee record does not exist" />
      </div>
    );
  }

  return (
    <div style={pageStyle} className="employee-form-page">
      <PageHeader
        title={isEditMode ? "Edit Employee" : "Add Employee"}
        subtitle={
          isEditMode
            ? "Update the employee's details below"
            : "Fill in the details to add a new employee"
        }
      />

      {submitError && <p className="employee-form-page__error">{submitError}</p>}

      <EmployeeForm
        initialData={employee}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  );
}

export default EmployeeFormPage;