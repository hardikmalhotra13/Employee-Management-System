import { createContext, useState } from "react";

const EmployeeAuthContext = createContext(null);

function EmployeeAuthProvider({ children }) {
  const [employee, setEmployee] = useState(() => {
    const stored = localStorage.getItem("employee");
    return stored ? JSON.parse(stored) : null;
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem("employee_token");
  });

  const isAuthenticated = !!token;

  const login = (token, employee) => {
    localStorage.setItem("employee_token", token);
    localStorage.setItem("employee", JSON.stringify(employee));
    setToken(token);
    setEmployee(employee);
  };

  const logout = () => {
    localStorage.removeItem("employee_token");
    localStorage.removeItem("employee");
    setToken(null);
    setEmployee(null);
  };

  return (
    <EmployeeAuthContext.Provider value={{ employee, token, isAuthenticated, login, logout }}>
      {children}
    </EmployeeAuthContext.Provider>
  );
}

export { EmployeeAuthContext, EmployeeAuthProvider };