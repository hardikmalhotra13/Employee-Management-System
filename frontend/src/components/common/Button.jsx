function Button({
  variant = "secondary",
  type = "button",
  disabled = false,
  onClick,
  children,
  className = "",
}) {
  const variantClass = `button button--${variant}`;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${variantClass} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export default Button;