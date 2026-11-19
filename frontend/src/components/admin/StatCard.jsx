export default function StatCard({ title, value, change, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      className={`stat-card${onClick ? " stat-card-interactive" : ""}`}
      onClick={onClick}
      disabled={!onClick}
      aria-label={onClick ? `Open ${title}` : undefined}
    >
      <div>
        <div className="stat-title">{title}</div>
        <div className="stat-value">{value}</div>
        {change && <span className="stat-badge">{change}</span>}
      </div>
      {Icon && (
        <div className="stat-icon-box">
          <Icon size={22} />
        </div>
      )}
    </button>
  );
}
