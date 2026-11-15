import styles from "./FormInput.module.css";

function FormInput({
  label,
  name,
  value,
  onChange,
  type = "text",
  options = [],
  error,
  required = false,
  disabled = false,
}) {
  return (
    <div className={styles.formInput}>
      <label htmlFor={name} className={styles.label}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </label>

      {type === "select" ? (
        <select
          id={name}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${styles.control} ${error ? styles.controlError : ""}`.trim()}
        >
          <option value="">Select {label.toLowerCase()}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${styles.control} ${error ? styles.controlError : ""}`.trim()}
        />
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

export default FormInput;