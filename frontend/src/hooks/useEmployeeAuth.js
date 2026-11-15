import { useContext } from "react";
import { EmployeeAuthContext } from "../context/EmployeeAuthContext.jsx";

function useEmployeeAuth() {
  return useContext(EmployeeAuthContext);
}

export default useEmployeeAuth;