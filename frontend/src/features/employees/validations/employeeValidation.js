const VALID_GENDERS = ["Male", "Female", "Other"];
const VALID_STATUSES = ["Active", "On Probation", "On Notice", "Inactive"];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isFutureDate(dateString) {
  const inputDate = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return inputDate > today;
}

export function validateEmployee(data, currentEmployeeId) {
  const errors = {};

  if (!data.first_name?.trim()) errors.first_name = "First name is required";
  if (!data.last_name?.trim()) errors.last_name = "Last name is required";
  if (!data.email?.trim()) errors.email = "Email is required";
  if (!data.phone?.trim()) errors.phone = "Phone is required";
  if (!data.gender) errors.gender = "Gender is required";
  if (!data.date_of_birth) errors.date_of_birth = "Date of birth is required";
  if (!data.joining_date) errors.joining_date = "Joining date is required";
  if (!data.department_id) errors.department_id = "Department is required";
  if (!data.role_id) errors.role_id = "Role is required";
  if (!data.grade_id) errors.grade_id = "Grade is required";
  if (!data.shift_id) errors.shift_id = "Shift is required";

  if (data.email && !EMAIL_PATTERN.test(data.email)) {
    errors.email = "Enter a valid email address";
  }

  if (data.phone && !/^\d{10}$/.test(data.phone)) {
    errors.phone = "Phone number must be exactly 10 digits";
  }

  if (data.gender && !VALID_GENDERS.includes(data.gender)) {
    errors.gender = "Gender must be Male, Female, or Other";
  }

  if (data.date_of_birth && isFutureDate(data.date_of_birth)) {
    errors.date_of_birth = "Date of birth cannot be a future date";
  }

  if (data.joining_date && isFutureDate(data.joining_date)) {
    errors.joining_date = "Joining date cannot be a future date";
  }

  if (data.status && !VALID_STATUSES.includes(data.status)) {
    errors.status = "Status must be Active, On Probation, On Notice, or Inactive";
  }

  if (
    data.reporting_manager_id &&
    currentEmployeeId &&
    String(data.reporting_manager_id) === String(currentEmployeeId)
  ) {
    errors.reporting_manager_id = "An employee cannot report to themselves";
  }

  return errors;
}