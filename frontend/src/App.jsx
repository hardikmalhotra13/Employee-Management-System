import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes.jsx";
import EmployeeRoutes from "./routes/EmployeeRoutes.jsx";

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <EmployeeRoutes />
    </BrowserRouter>
  );
}

export default App;