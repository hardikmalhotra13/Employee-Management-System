import "./RecoveryCodesDisplay.css";

function RecoveryCodesDisplay({ codes }) {
  return (
    <div className="recovery-codes-display">
      <p className="recovery-codes-display__warning">
        Save these recovery codes somewhere safe, like a password manager. Each code can be used once to sign in
        if you lose access to your authenticator app. They will not be shown again.
      </p>
      <div className="recovery-codes-display__grid">
        {codes.map((c) => (
          <code key={c} className="recovery-codes-display__code">{c}</code>
        ))}
      </div>
    </div>
  );
}

export default RecoveryCodesDisplay;