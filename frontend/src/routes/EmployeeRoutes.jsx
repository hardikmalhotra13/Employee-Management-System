import { Routes, Route } from "react-router-dom";
import EmployeePrivateRoute from "./EmployeePrivateRoute.jsx";
import employeeRoutePaths from "./employeeRoutePaths.js";

import EmployeeLayout from "../components/layout/EmployeeLayout.jsx";

import EmployeeLoginPage from "../features/employeeAuth/pages/EmployeeLoginPage.jsx";
import EmployeeForgotPasswordPage from "../features/employeeAuth/pages/EmployeeForgotPasswordPage.jsx";
import EmployeeSetPasswordPage from "../features/employeeAuth/pages/EmployeeSetPasswordPage.jsx";
import EmployeeDashboardPage from "../features/employeeSelf/pages/EmployeeDashboardPage.jsx";
import MyProfilePage from "../features/employeeSelf/pages/MyProfilePage.jsx";
import MyDocumentsPage from "../features/employeeSelf/pages/MyDocumentsPage.jsx";
import EmployeeNotificationsPage from "../features/employeeSelf/pages/EmployeeNotificationsPage.jsx";
import MyAttendancePage from "../features/employeeSelf/pages/MyAttendancePage.jsx";
import MyLeavePage from "../features/employeeSelf/pages/MyLeavePage.jsx";
import MyHolidaysPage from "../features/employeeSelf/pages/MyHolidaysPage.jsx";
import EmployeeSettingsPage from "../features/employeeSelf/pages/EmployeeSettingsPage.jsx";
import MyTeamPage from "../features/manager/pages/MyTeamPage.jsx";
import TeamMemberProfilePage from "../features/manager/pages/TeamMemberProfilePage.jsx";
import TeamAttendancePage from "../features/manager/pages/TeamAttendancePage.jsx";
import TeamLeavePage from "../features/manager/pages/TeamLeavePage.jsx";
import MyAssetsPage from "../features/employeeSelf/pages/MyAssetsPage.jsx";
import MyPerformancePage from "../features/employeeSelf/pages/MyPerformancePage.jsx";
import TeamPerformancePage from "../features/manager/pages/TeamPerformancePage.jsx";
import MyTrainingPage from "../features/employeeSelf/pages/MyTrainingPage.jsx";
import TeamTrainingPage from "../features/manager/pages/TeamTrainingPage.jsx";

function EmployeeRoutes() {
  return (
    <Routes>
      <Route path={employeeRoutePaths.LOGIN} element={<EmployeeLoginPage />} />
      <Route path={employeeRoutePaths.FORGOT_PASSWORD} element={<EmployeeForgotPasswordPage />} />
      <Route path={employeeRoutePaths.SET_PASSWORD} element={<EmployeeSetPasswordPage />} />

      <Route element={<EmployeePrivateRoute />}>
        <Route element={<EmployeeLayout />}>
          <Route path={employeeRoutePaths.DASHBOARD} element={<EmployeeDashboardPage />} />
          <Route path={employeeRoutePaths.PROFILE} element={<MyProfilePage />} />
          <Route path={employeeRoutePaths.ATTENDANCE} element={<MyAttendancePage />} />
          <Route path={employeeRoutePaths.LEAVE} element={<MyLeavePage />} />
          <Route path={employeeRoutePaths.HOLIDAYS} element={<MyHolidaysPage />} />
          <Route path={employeeRoutePaths.TEAM} element={<MyTeamPage />} />
          <Route path={employeeRoutePaths.TEAM_MEMBER_VIEW_PATTERN} element={<TeamMemberProfilePage />} />
          <Route path={employeeRoutePaths.TEAM_ATTENDANCE} element={<TeamAttendancePage />} />
          <Route path={employeeRoutePaths.TEAM_LEAVE} element={<TeamLeavePage />} />
          <Route path={employeeRoutePaths.PERFORMANCE} element={<MyPerformancePage />} />
          <Route path={employeeRoutePaths.TEAM_PERFORMANCE} element={<TeamPerformancePage />} />
          <Route path={employeeRoutePaths.TRAINING} element={<MyTrainingPage />} />
          <Route path={employeeRoutePaths.TEAM_TRAINING} element={<TeamTrainingPage />} />
          <Route path={employeeRoutePaths.ASSETS} element={<MyAssetsPage />} />
          <Route path={employeeRoutePaths.DOCUMENTS} element={<MyDocumentsPage />} />
          <Route path={employeeRoutePaths.NOTIFICATIONS} element={<EmployeeNotificationsPage />} />
          <Route path={employeeRoutePaths.SETTINGS} element={<EmployeeSettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default EmployeeRoutes;