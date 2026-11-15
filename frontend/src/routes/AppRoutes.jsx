import { Routes, Route, Navigate } from "react-router-dom";
import PrivateRoute from "./PrivateRoute.jsx";
import routePaths from "./routePaths.js";

import AdminLayout from "../components/layout/AdminLayout.jsx";

import LoginPage from "../features/auth/pages/LoginPage.jsx";
import ForgotPasswordPage from "../features/auth/pages/ForgotPasswordPage.jsx";
import SetPasswordPage from "../features/auth/pages/SetPasswordPage.jsx";
import GoogleCallbackPage from "../features/auth/pages/GoogleCallbackPage.jsx";
import DashboardPage from "../features/dashboard/pages/DashboardPage.jsx";
import EmployeeListPage from "../features/employees/pages/EmployeeListPage.jsx";
import EmployeeFormPage from "../features/employees/pages/EmployeeFormPage.jsx";
import EmployeeProfilePage from "../features/employees/pages/EmployeeProfilePage.jsx";
import DepartmentListPage from "../features/departments/pages/DepartmentListPage.jsx";
import RoleListPage from "../features/roles/pages/RoleListPage.jsx";
import GradeListPage from "../features/grades/pages/GradeListPage.jsx";
import ShiftListPage from "../features/shifts/pages/ShiftListPage.jsx";
import RosterPage from "../features/roster/pages/RosterPage.jsx";
import AttendancePage from "../features/attendance/pages/AttendancePage.jsx";
import HolidaysPage from "../features/holidays/pages/HolidaysPage.jsx";
import LeaveRequestsPage from "../features/leave/pages/LeaveRequestsPage.jsx";
import AssetTypesPage from "../features/assets/pages/AssetTypesPage.jsx";
import AssetsPage from "../features/assets/pages/AssetsPage.jsx";
import OnboardingItemsPage from "../features/onboarding/pages/OnboardingItemsPage.jsx";
import OffboardingItemsPage from "../features/offboarding/pages/OffboardingItemsPage.jsx";
import ReviewCyclesPage from "../features/performance/pages/ReviewCyclesPage.jsx";
import TrainingProgramsPage from "../features/training/pages/TrainingProgramsPage.jsx";
import SettingsPage from "../features/settings/pages/SettingsPage.jsx";
import AdminNotificationsPage from "../features/notifications/pages/AdminNotificationsPage.jsx";

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={routePaths.LOGIN} replace />} />
      <Route path={routePaths.LOGIN} element={<LoginPage />} />
      <Route path={routePaths.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
      <Route path={routePaths.SET_PASSWORD} element={<SetPasswordPage />} />
      <Route path={routePaths.GOOGLE_CALLBACK} element={<GoogleCallbackPage />} />

      <Route element={<PrivateRoute />}>
        <Route element={<AdminLayout />}>
          <Route path={routePaths.DASHBOARD} element={<DashboardPage />} />

          <Route path={routePaths.EMPLOYEES} element={<EmployeeListPage />} />
          <Route path={routePaths.EMPLOYEE_NEW} element={<EmployeeFormPage />} />
          <Route path={routePaths.EMPLOYEE_EDIT_PATTERN} element={<EmployeeFormPage />} />
          <Route path={routePaths.EMPLOYEE_VIEW_PATTERN} element={<EmployeeProfilePage />} />

          <Route path={routePaths.DEPARTMENTS} element={<DepartmentListPage />} />
          <Route path={routePaths.ROLES} element={<RoleListPage />} />
          <Route path={routePaths.GRADES} element={<GradeListPage />} />
          <Route path={routePaths.SHIFTS} element={<ShiftListPage />} />
          <Route path={routePaths.ROSTER} element={<RosterPage />} />
          <Route path={routePaths.ATTENDANCE} element={<AttendancePage />} />
          <Route path={routePaths.HOLIDAYS} element={<HolidaysPage />} />
          <Route path={routePaths.LEAVE} element={<LeaveRequestsPage />} />
          <Route path={routePaths.ASSET_TYPES} element={<AssetTypesPage />} />
          <Route path={routePaths.ASSETS} element={<AssetsPage />} />
          <Route path={routePaths.ONBOARDING_ITEMS} element={<OnboardingItemsPage />} />
          <Route path={routePaths.OFFBOARDING_ITEMS} element={<OffboardingItemsPage />} />
          <Route path={routePaths.REVIEW_CYCLES} element={<ReviewCyclesPage />} />
          <Route path={routePaths.TRAINING_PROGRAMS} element={<TrainingProgramsPage />} />

          <Route path={routePaths.SETTINGS} element={<SettingsPage />} />
          <Route path={routePaths.NOTIFICATIONS} element={<AdminNotificationsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default AppRoutes;