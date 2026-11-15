import "../../auth/pages/SetPasswordPage.css";
import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import { validateToken, setPassword as setPasswordApi } from "../../../services/api/employeeSelfApi.js";
import { validatePasswordStrength } from "../../../utils/validators.js";

function BrandMark() {
  return <div className="set-password-page__brand-mark">E</div>;
}

function EmployeeSetPasswordPage() {
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
    <div className="set-password-page">
      <div className="set-password-page__card">
        <div className="set-password-page__accent-bar" />
        <div className="set-password-page__body">
          <div className="set-password-page__header">
            <BrandMark />
            <h1 className="set-password-page__title">Employee Management System</h1>
            <p className="set-password-page__subtitle">
              Create a new password for your account.
            </p>
          </div>

          {status === "loading" && (
            <p className="set-password-page__message">Checking your link...</p>
          )}

          {status === "invalid" && (
            <>
              <p className="set-password-page__message set-password-page__message--error">
                This link is invalid or has expired.
              </p>
              <Link to={employeeRoutePaths.LOGIN} className="set-password-page__link">
                Back to login
              </Link>
            </>
          )}

          {status === "form" && (
            <form className="set-password-page__form" onSubmit={handleSubmit} noValidate>
              <div className="set-password-page__input-wrap">
                <LockKeyhole size={16} className="set-password-page__input-icon" />
                <FormInput
                  label="New Password"
                  name="new_password"
                  type="password"
                  value={newPassword}
                  onChange={setNewPassword}
                />
              </div>

              <div className="set-password-page__input-wrap">
                <LockKeyhole size={16} className="set-password-page__input-icon" />
                <FormInput
                  label="Confirm Password"
                  name="confirm_password"
                  type="password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                />
              </div>

              {formError && <p className="set-password-page__error">{formError}</p>}

              <button type="submit" className="set-password-page__submit" disabled={isSubmitting}>
                {isSubmitting ? "Setting password..." : "Set password"}
              </button>
            </form>
          )}

          {status === "success" && (
            <>
              <p className="set-password-page__message set-password-page__message--success">
                Your password has been set. You can now log in.
              </p>
              <Link to={employeeRoutePaths.LOGIN} className="set-password-page__link">
                Go to login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmployeeSetPasswordPage;