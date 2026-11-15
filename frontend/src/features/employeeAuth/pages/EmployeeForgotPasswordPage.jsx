import "../../auth/pages/ForgotPasswordPage.css";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import { forgotPassword } from "../../../services/api/employeeSelfApi.js";

function BrandMark() {
  return <div className="forgot-password-page__brand-mark">E</div>;
}

function EmployeeForgotPasswordPage() {
  const [status, setStatus] = useState("form"); // "form" | "submitted"

  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim()) {
      setFieldError("Email is required");
      return;
    }

    setFieldError("");
    setFormError("");
    setIsSubmitting(true);

    try {
      await forgotPassword(email.trim());
      setStatus("submitted");
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="forgot-password-page">
      <div className="forgot-password-page__card">
        <div className="forgot-password-page__accent-bar" />
        <div className="forgot-password-page__body">
          <div className="forgot-password-page__header">
            <BrandMark />
            <h1 className="forgot-password-page__title">Employee Management System</h1>
            <p className="forgot-password-page__subtitle">
              Enter your email to receive a password reset link.
            </p>
          </div>

          {status === "form" && (
            <>
              <form className="forgot-password-page__form" onSubmit={handleSubmit} noValidate>
                <div className="forgot-password-page__input-wrap">
                  <Mail size={16} className="forgot-password-page__input-icon" />
                  <FormInput
                    label="Email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    error={fieldError}
                  />
                </div>

                {formError && <p className="forgot-password-page__error">{formError}</p>}

                <button type="submit" className="forgot-password-page__submit" disabled={isSubmitting}>
                  {isSubmitting ? "Sending..." : "Send reset link"}
                </button>
              </form>

              <Link to={employeeRoutePaths.LOGIN} className="forgot-password-page__link">
                Back to login
              </Link>
            </>
          )}

          {status === "submitted" && (
            <>
              <p className="forgot-password-page__message forgot-password-page__message--success">
                If that email is registered, a password reset link has been sent.
              </p>
              <Link to={employeeRoutePaths.LOGIN} className="forgot-password-page__link">
                Back to login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmployeeForgotPasswordPage;