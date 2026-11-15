import { Navigate, Outlet, useLocation } from "react-router-dom";
import useEmployeeAuth from "../hooks/useEmployeeAuth.js";
import employeeRoutePaths from "./employeeRoutePaths.js";

function EmployeePrivateRoute() {
  const { isAuthenticated } = useEmployeeAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to={employeeRoutePaths.LOGIN} state={{ from: location }} replace />;
  }

  return <Outlet />;
}

export default EmployeePrivateRoute;