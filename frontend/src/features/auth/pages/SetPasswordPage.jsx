import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import AdminAuthShell from "../components/AdminAuthShell.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import routePaths from "../../../routes/routePaths.js";
import { validateToken, setPassword as setPasswordApi } from "../../../services/api/authApi.js";
import { validatePasswordStrength } from "../../../utils/validators.js";

function SetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState("loading"); // "loading" | "invalid" | "form" | "success"

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    validateToken(token)
      .then(() => setStatus("form"))
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      setFormError("Please enter and confirm your new password");
      return;
    }

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError("Passwords do not match");
      return;
    }

    setFormError("");
    setIsSubmitting(true);

    try {
      await setPasswordApi(token, newPassword);
      setStatus("success");
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminAuthShell>
      <div className="admin-auth__card-header">
        <h1 className="admin-auth__card-title">Create a new password</h1>
        <p className="admin-auth__card-subtitle">
          Choose a strong password for your account.
        </p>
      </div>

      {status === "loading" && (
        <p className="admin-auth__status-message">Checking your link...</p>
      )}

      {status === "invalid" && (
        <>
          <p className="admin-auth__status-message admin-auth__status-message--error">
            This link is invalid or has expired.
          </p>
          <Link to={routePaths.LOGIN} className="admin-auth__link" style={{ marginTop: 0 }}>
            Back to login
          </Link>
        </>
      )}

      {status === "form" && (
        <form className="admin-auth__form" onSubmit={handleSubmit} noValidate>
          <div className="admin-auth__input-wrap">
            <LockKeyhole size={16} className="admin-auth__input-icon" style={{ top: 38 }} />
            <FormInput
              label="New Password"
              name="new_password"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
            />
          </div>

          <div className="admin-auth__input-wrap">
            <LockKeyhole size={16} className="admin-auth__input-icon" style={{ top: 38 }} />
            <FormInput
              label="Confirm Password"
              name="confirm_password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
          </div>

          {formError && <p className="admin-auth__error">{formError}</p>}

          <button type="submit" className="admin-auth__submit" disabled={isSubmitting}>
            {isSubmitting ? "Setting password..." : "Set password"}
          </button>
        </form>
      )}

      {status === "success" && (
        <>
          <p className="admin-auth__status-message admin-auth__status-message--success">
            Your password has been set. You can now log in.
          </p>
          <Link to={routePaths.LOGIN} className="admin-auth__link" style={{ marginTop: 0 }}>
            Go to login
          </Link>
        </>
      )}
    </AdminAuthShell>
  );
}

export default SetPasswordPage;