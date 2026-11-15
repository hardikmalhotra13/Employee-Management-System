import "./SearchBar.css";
import { Search } from "lucide-react";

function SearchBar({ value, onChange, placeholder = "Search..." }) {
  return (
    <div className="search-bar">
      <Search size={15} className="search-bar__icon" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="search-bar__input"
      />
    </div>
  );
}

export default SearchBar;