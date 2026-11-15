import "./Pagination.css";
import { ChevronLeft, ChevronRight } from "lucide-react";

function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="pagination">
      <span className="pagination__summary">
        Showing {start}-{end} of {total}
      </span>

      <div className="pagination__controls">
        <button
          type="button"
          className="pagination__button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft size={16} />
        </button>

        <span className="pagination__page">
          Page {page} of {totalPages}
        </span>

        <button
          type="button"
          className="pagination__button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export default Pagination;