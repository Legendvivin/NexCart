import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Plus, Tag, Trash2 } from "lucide-react";

const API = "http://127.0.0.1:8000/admin/categories";

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [newName, setNewName] = useState("");
  const [newSpecs, setNewSpecs] = useState("");
  const [error, setError] = useState("");
  const loadCategories = useCallback(async () => {
    try {
      const response = await axios.get(API);
      setCategories(response.data);
      setError("");
    } catch (loadError) {
      console.error("Failed loading categories:", loadError);
      setError("Categories could not be loaded.");
    }
  }, []);
  useEffect(() => {
    loadCategories();
    const poll = window.setInterval(loadCategories, 7000);
    return () => window.clearInterval(poll);
  }, [loadCategories]);

  const handleAddCategory = async (event) => {
    event.preventDefault();
    try {
      await axios.post(API, { name: newName.trim(), specifications: newSpecs.split(",").map((spec) => spec.trim()).filter(Boolean) });
      setNewName("");
      setNewSpecs("");
      loadCategories();
    } catch (saveError) {
      setError(saveError.response?.data?.detail || "Category could not be saved.");
    }
  };

  const handleDelete = async (category) => {
    try {
      await axios.delete(`${API}/${category.id}`);
      loadCategories();
    } catch (deleteError) {
      setError(deleteError.response?.data?.detail || "Category could not be deleted.");
    }
  };

  return <div>
    <div className="admin-category-page-heading"><h1>Categories & Specifications</h1><p>Organize products into clear groups and define the details shoppers can compare.</p></div>
    {error && <p className="admin-category-error" role="alert">{error}</p>}
    <form onSubmit={handleAddCategory} className="dashboard-panel admin-category-form">
      <div className="admin-category-form-copy"><span className="admin-category-form-icon"><Plus size={18} /></span><div><h2>Add a category</h2><p>Create a product group and its optional specification labels.</p></div></div>
      <div className="admin-category-form-fields">
        <input type="text" aria-label="Category name" placeholder="Category name" value={newName} onChange={(event) => setNewName(event.target.value)} required />
        <input type="text" aria-label="Specifications" placeholder="Specifications, separated by commas (optional)" value={newSpecs} onChange={(event) => setNewSpecs(event.target.value)} />
        <button type="submit" className="admin-category-submit"><Plus size={17} /> Add category</button>
      </div>
    </form>
    <div className="admin-category-grid">{categories.map((category) => <article key={category.id} className="admin-category-card">
      <header className="admin-category-card-header"><div className="admin-category-card-title"><span><Tag size={17} /></span><h2 title={category.name}>{category.name}</h2></div><button type="button" onClick={() => handleDelete(category)} className="admin-category-delete" aria-label={`Delete ${category.name}`} title={`Delete ${category.name}`}><Trash2 size={16} /></button></header>
      <div className="admin-category-card-count"><strong>{category.product_count}</strong><span>{category.product_count === 1 ? "product" : "products"}</span></div>
      <div className="admin-category-specs-label">Specifications</div>
      {(category.specs || []).length ? <div className="admin-category-specs">{category.specs.map((spec) => <span key={spec}>{spec}</span>)}</div> : <p className="admin-category-no-specs">No specifications added</p>}
    </article>)}</div>
    {categories.length === 0 && <div className="admin-category-empty"><Tag size={22} /><strong>No categories yet</strong><span>Add your first category above to organize products.</span></div>}
  </div>;
}
