import { Navigate, Outlet, useLocation } from "react-router-dom";
import useAuth from "../hooks/useAuth.js";
import routePaths from "./routePaths.js";

function PrivateRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to={routePaths.LOGIN} state={{ from: location }} replace />;
  }

  return <Outlet />;
}

export default PrivateRoute;