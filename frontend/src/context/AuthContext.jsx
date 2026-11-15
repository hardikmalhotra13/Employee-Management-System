import { createContext, useState } from "react";

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(() => {
    const stored = localStorage.getItem("admin");
    return stored ? JSON.parse(stored) : null;
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem("token");
  });

  const isAuthenticated = !!token;

  const login = (token, admin) => {
    localStorage.setItem("token", token);
    localStorage.setItem("admin", JSON.stringify(admin));
    setToken(token);
    setAdmin(admin);
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("admin");
    setToken(null);
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ admin, token, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext, AuthProvider };