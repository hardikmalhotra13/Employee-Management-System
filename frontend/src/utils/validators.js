const SPECIAL_CHAR_PATTERN = /[^A-Za-z0-9]/;
const PASSWORD_MIN_LENGTH = 8;

export function validatePasswordStrength(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must contain at least one letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  if (!SPECIAL_CHAR_PATTERN.test(password)) {
    return "Password must contain at least one special character";
  }
  return "";
}