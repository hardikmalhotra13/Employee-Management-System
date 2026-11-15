const employeeRoutePaths = {
  LOGIN: "/employee/login",
  FORGOT_PASSWORD: "/employee/forgot-password",
  SET_PASSWORD: "/employee/set-password",
  DASHBOARD: "/employee/dashboard",
  PROFILE: "/employee/profile",

  TEAM: "/employee/team",
  TEAM_MEMBER_VIEW: (id) => `/employee/team/${id}`,
  TEAM_MEMBER_VIEW_PATTERN: "/employee/team/:id",

  ATTENDANCE: "/employee/attendance",
  TEAM_ATTENDANCE: "/employee/team-attendance",

  LEAVE: "/employee/leave",
  TEAM_LEAVE: "/employee/team-leave",
  HOLIDAYS: "/employee/holidays",

  PERFORMANCE: "/employee/performance",
  TEAM_PERFORMANCE: "/employee/team-performance",

  TRAINING: "/employee/training",
  TEAM_TRAINING: "/employee/team-training",

  ASSETS: "/employee/assets",
  DOCUMENTS: "/employee/documents",
  NOTIFICATIONS: "/employee/notifications",
  SETTINGS: "/employee/settings",
};

export default employeeRoutePaths;