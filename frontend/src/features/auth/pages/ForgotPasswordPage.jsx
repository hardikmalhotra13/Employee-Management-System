import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import AdminAuthShell from "../components/AdminAuthShell.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import routePaths from "../../../routes/routePaths.js";
import { forgotPassword } from "../../../services/api/authApi.js";

function ForgotPasswordPage() {
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
    <AdminAuthShell>
      <div className="admin-auth__card-header">
        <h1 className="admin-auth__card-title">Reset your password</h1>
        <p className="admin-auth__card-subtitle">
          Enter your email to receive a password reset link.
        </p>
      </div>

      {status === "form" && (
        <>
          <form className="admin-auth__form" onSubmit={handleSubmit} noValidate>
            <div className="admin-auth__input-wrap">
              <Mail size={16} className="admin-auth__input-icon" style={{ top: 38 }} />
              <FormInput
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={setEmail}
                error={fieldError}
              />
            </div>

            {formError && <p className="admin-auth__error">{formError}</p>}

            <button type="submit" className="admin-auth__submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send reset link"}
            </button>
          </form>

          <Link to={routePaths.LOGIN} className="admin-auth__link">
            Back to login
          </Link>
        </>
      )}

      {status === "submitted" && (
        <>
          <p className="admin-auth__status-message admin-auth__status-message--success">
            If that email is registered, a password reset link has been sent.
          </p>
          <Link to={routePaths.LOGIN} className="admin-auth__link" style={{ marginTop: 0 }}>
            Back to login
          </Link>
        </>
      )}
    </AdminAuthShell>
  );
}

export default ForgotPasswordPage;