const routePaths = {
  LOGIN: "/login",
  FORGOT_PASSWORD: "/forgot-password",
  SET_PASSWORD: "/set-password",
  GOOGLE_CALLBACK: "/auth/google/callback",
  DASHBOARD: "/admin/dashboard",

  EMPLOYEES: "/admin/employees",
  EMPLOYEE_NEW: "/admin/employees/new",
  EMPLOYEE_VIEW: (id) => `/admin/employees/${id}`,
  EMPLOYEE_VIEW_PATTERN: "/admin/employees/:id",
  EMPLOYEE_EDIT: (id) => `/admin/employees/${id}/edit`,
  EMPLOYEE_EDIT_PATTERN: "/admin/employees/:id/edit",

  DEPARTMENTS: "/admin/departments",
  ROLES: "/admin/roles",
  GRADES: "/admin/grades",
  SHIFTS: "/admin/shifts",
  ROSTER: "/admin/roster",
  ATTENDANCE: "/admin/attendance",
  HOLIDAYS: "/admin/holidays",
  LEAVE: "/admin/leave",
  ASSET_TYPES: "/admin/asset-types",
  ASSETS: "/admin/assets",

  ONBOARDING_ITEMS: "/admin/onboarding-items",
  OFFBOARDING_ITEMS: "/admin/offboarding-items",

  REVIEW_CYCLES: "/admin/review-cycles",

  TRAINING_PROGRAMS: "/admin/training-programs",

  SETTINGS: "/admin/settings",

  NOTIFICATIONS: "/admin/notifications",
};

export default routePaths;