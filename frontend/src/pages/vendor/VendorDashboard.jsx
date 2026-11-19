import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import NotificationBell from "../../components/NotificationBell";
import "./VendorDashboard.css";

const SELECTABLE_OPTION_KEY = /(color|colour|ram|memory|storage|capacity|size|variant|style|fit|pattern|finish|edition|waist|shoe|flavo[u]?r|scent|pack size|net quantity)/i;

function normalizeVariantRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.key.trim();
    const choices = row.value.split(/[,|]/).map((choice) => choice.trim()).filter(Boolean);
    if (!key || !choices.length) return;
    grouped.set(key, [...new Set([...(grouped.get(key) || []), ...choices])]);
  });
  return [...grouped].map(([key, choices]) => ({ key, choices }));
}

function expandVariantCombinations(rows) {
  const options = normalizeVariantRows(rows);
  if (!options.length) return [{}];
  return options.reduce((combinations, option) => combinations.flatMap((combination) => option.choices.map((choice) => ({ ...combination, [option.key]: choice }))), [{}]);
}

function combinationKey(options) {
  return JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))));
}

function buildColorVariantOptions(color, spec, colorKey = "Color", specKey = "Variant") {
  return {
    ...(color?.trim() ? { [colorKey || "Color"]: color.trim() } : {}),
    ...(spec?.trim() ? { [specKey || "Variant"]: spec.trim() } : {}),
  };
}

function getCategoryVariantKeys(categoryName, specifications = [], subcategory = "") {
  const category = String(categoryName || "").toLowerCase();
  if (/shoe|footwear/.test(category) || /shoe|footwear/.test(String(subcategory).toLowerCase())) return ["Color", "Size"];
  if (/fashion|apparel|clothing/.test(category)) return ["Color", "Size"];
  if (/grocery|food/.test(category)) return ["Pack Size", "Flavor"];
  if (/home|living/.test(category)) return ["Color", "Material Variant"];
  if (/wearable/.test(category)) return ["Color", "Strap Material Variant"];
  if (/electronic/.test(category)) return ["Color", "Storage"];
  const suggested = (specifications || []).filter((key) => SELECTABLE_OPTION_KEY.test(key));
  const color = suggested.find((key) => /colou?r/i.test(key));
  const secondary = suggested.find((key) => key !== color);
  return suggested.length ? [color || suggested[0], secondary || "Variant"] : ["Variant Group", "Variant"];
}

function isCategoryVariantField(categoryName, fieldName, variantKeys = []) {
  const normalizedField = String(fieldName || "").toLowerCase();
  if (variantKeys.some((key) => key.toLowerCase() === normalizedField)) return true;
  const category = String(categoryName || "").toLowerCase();
  return (/home|living/.test(category) && ["material", "dimensions", "weight"].includes(normalizedField))
    || (/wearable/.test(category) && normalizedField === "strap material");
}

export default function VendorDashboard() {
  const navigate = useNavigate();
  const token = localStorage.getItem("nexcart_vendor_token");
  const vendorId = localStorage.getItem("nexcart_vendor_id");
  const [storeName, setStoreName] = useState(localStorage.getItem("nexcart_store_name") || localStorage.getItem("nexcart_vendor_store") || "My Store");
  const vendorName = localStorage.getItem("nexcart_vendor_name") || "Verified Merchant";

  const [activeNav, setActiveNav] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [storeBio, setStoreBio] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [storeLat, setStoreLat] = useState("");
  const [storeLng, setStoreLng] = useState("");
  const [payoutUpiId, setPayoutUpiId] = useState("");
  const [categories, setCategories] = useState([
    { name: "Electronics", specifications: ["Brand", "Warranty", "Connectivity", "Color"] },
    { name: "Audio Gear", specifications: ["Driver Size", "Battery Life", "Noise Cancellation", "Color"] },
    { name: "Smart Wearables", specifications: ["Display", "Water Resistance", "Battery", "Strap Material"] },
    { name: "Fashion", specifications: ["Size", "Fabric", "Fit Type", "Color"] },
  ]);

  // Catalog Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [stockTab, setStockTab] = useState("all"); // "all" | "instock" | "low" | "out"
  const [toast, setToast] = useState("");
  const [packingOrderId, setPackingOrderId] = useState(null);

  // Advanced Slide-Over Product Studio State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [modalTab, setModalTab] = useState("general");
  const [showPreview, setShowPreview] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);

  const [form, setForm] = useState({
    name: "",
    brand: "",
    sku: "",
    category_name: "Electronics",
    subcategory: "",
    description: "",
    price: "",
    discount_price: "",
    cost_price: "",
    stock: "",
    low_stock_threshold: "5",
    weight: "",
    dimensions: "",
  });

  const [images, setImages] = useState([]);
  const [colorImageUrlInputs, setColorImageUrlInputs] = useState({});
  const [variantConfigurations, setVariantConfigurations] = useState({});
  const [colorVariantGroups, setColorVariantGroups] = useState([]);
  const [specs, setSpecs] = useState([]);
  const [highlights, setHighlights] = useState(["", ""]);
  const currentCategory = categories.find((category) => category.name === form.category_name);
  const categoryOptionKeys = getCategoryVariantKeys(form.category_name, currentCategory?.specifications, form.subcategory);
  const primaryOptionKey = categoryOptionKeys[0] || "Option Group";
  const secondaryOptionKey = categoryOptionKeys[1] || "Variant";
  const isApparelCategory = /fashion|apparel|clothing/i.test(form.category_name);
  const isShoeCategory = /shoe|footwear/i.test(form.subcategory) || /shoe|footwear/i.test(form.category_name);
  const productNamePlaceholder = isShoeCategory
    ? "e.g. Lightweight running shoes"
    : isApparelCategory
    ? "e.g. Everyday cotton T-shirt"
    : /grocery|food/i.test(form.category_name)
    ? "e.g. Whole grain oats, 1 kg"
    : /home|living/i.test(form.category_name)
    ? "e.g. Solid wood bedside table"
    : "e.g. Wireless noise-cancelling headphones";
  const subcategoryOptions = /shoe|footwear/i.test(form.category_name)
    ? ["Running", "Casual", "Formal", "Sandals"]
    : /fashion/i.test(form.category_name)
    ? ["Clothing", "Shoes", "Accessories"]
    : /grocery|food/i.test(form.category_name)
    ? ["Packaged food", "Fresh produce", "Beverages", "Household essentials"]
    : /home|living/i.test(form.category_name)
    ? ["Furniture", "Kitchen", "Decor", "Storage", "Lighting"]
    : /electronic/i.test(form.category_name)
    ? ["Mobile phones", "Computers", "Audio", "Appliances", "Accessories"]
    : [];

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  };

  const openProductEditor = (product = null) => {
    if (!product) {
      setEditingProductId(null);
      setShowPreview(false);
      setPreviewImageUrl("");
      setColorImageUrlInputs({});
      const blankForm = { name: "", brand: "", sku: "", category_name: categories[0]?.name || "Electronics", subcategory: "", description: "", price: "", discount_price: "", cost_price: "", stock: "", low_stock_threshold: "5", weight: "", dimensions: "" };
      let savedDraft = null;
      try { savedDraft = JSON.parse(localStorage.getItem(`nexcart_product_draft_${vendorId}`) || "null"); } catch { savedDraft = null; }
      const draft = savedDraft && savedDraft.form ? savedDraft : null;
      setForm(draft?.form || blankForm);
      setImages([]);
      setVariantConfigurations({});
      const defaultCategory = categories.find((category) => category.name === blankForm.category_name);
      const defaultOptions = getCategoryVariantKeys(blankForm.category_name, defaultCategory?.specifications);
      const defaultPrimaryOption = defaultOptions[0] || "Color";
      const defaultSecondaryOption = defaultOptions[1] || "Variant";
      setColorVariantGroups(draft?.colorVariantGroups || [{ colorKey: defaultPrimaryOption, specKey: defaultSecondaryOption, color: "", sharedPrice: "", images: [], main_image: "", subvariants: [{ spec: "" }] }]);
      const restoredConfigurations = Object.fromEntries(Object.entries(draft?.variantConfigurations || {}).map(([key, configuration]) => {
        const originalPrice = configuration.original_price ?? configuration.price ?? draft?.form?.price ?? "";
        const inheritedOffer = configuration.original_price == null && Number(draft?.form?.discount_price) > 0 && Number(draft.form.discount_price) < Number(originalPrice) ? draft.form.discount_price : null;
        return [key, { ...configuration, original_price: originalPrice, price: inheritedOffer ?? configuration.price ?? originalPrice }];
      }));
      setVariantConfigurations(restoredConfigurations);
      const defaultDetails = (defaultCategory?.specifications || []).filter((key) => !isCategoryVariantField(blankForm.category_name, key, defaultOptions) && !/^brand$/i.test(key)).map((key) => ({ key, value: "" }));
      setSpecs(draft?.specs || defaultDetails);
      setHighlights(draft?.highlights || ["", ""]);
      setImages(draft?.images || []);
    } else {
      setShowPreview(false);
      setPreviewImageUrl("");
      setEditingProductId(product.id);
      setColorImageUrlInputs({});
      setForm({
        name: product.name || "", brand: product.brand || "", sku: product.sku || "",
        category_name: product.category || categories[0]?.name || "Electronics",
        subcategory: product.specifications?.Subcategory || "",
        description: product.description || "", price: String(product.price ?? ""),
        discount_price: product.discount_price == null ? "" : String(product.discount_price),
        cost_price: product.cost_price == null ? "" : String(product.cost_price),
        stock: String(product.stock ?? 0), low_stock_threshold: String(product.low_stock_threshold ?? 5),
        weight: product.weight || "",
        dimensions: product.specifications?.["Shipping dimensions"] || "",
      });
      const savedSpecs = product.specifications && typeof product.specifications === "object" ? Object.entries(product.specifications).filter(([key]) => !["Subcategory", "Shipping dimensions"].includes(key)).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join(", ") : String(value) })) : [];
      const savedVariants = savedSpecs.filter((row) => SELECTABLE_OPTION_KEY.test(row.key));
      const productCategory = categories.find((category) => category.name === product.category);
      const productOptionKeys = getCategoryVariantKeys(product.category, productCategory?.specifications, product.specifications?.Subcategory);
      const productPrimaryOptionKey = productOptionKeys[0] || "Color";
      const productDetailKeys = /shoe/i.test(product.specifications?.Subcategory || "")
        ? ["Material", "Gender", "Sole Material", "Closure Type"]
        : (productCategory?.specifications || []).filter((key) => !isCategoryVariantField(product.category, key, productOptionKeys) && !/^brand$/i.test(key));
      const productDetailsByKey = new Map(productDetailKeys.map((key) => [key, { key, value: "" }]));
      savedSpecs.filter((row) => !SELECTABLE_OPTION_KEY.test(row.key) && !isCategoryVariantField(product.category, row.key, productOptionKeys)).forEach((row) => productDetailsByKey.set(row.key, row));
      const savedGallery = product.image_url ? [product.image_url, ...(product.gallery_images || []).filter((image) => image !== product.image_url)] : (product.gallery_images || []);
      const savedConfigurations = product.variant_configurations || [];
      const grouped = new Map();
      savedConfigurations.forEach((configuration) => {
        const options = configuration.options || {};
        const colorKey = Object.keys(options).find((key) => key === productPrimaryOptionKey) || Object.keys(options)[0];
        const color = colorKey ? options[colorKey] : "";
        const specKey = Object.keys(options).find((key) => key !== colorKey);
        const spec = specKey ? options[specKey] : "";
        const group = grouped.get(color) || { colorKey: colorKey || "Color", specKey: specKey || "Variant", color, subvariants: [], priceValues: [], images: [], main_image: "" };
        if (!group.subvariants.some((item) => item.spec === spec)) group.subvariants.push({ spec });
        group.priceValues.push(configuration.price == null ? "" : String(configuration.price));
        if (configuration.images?.length) group.images = [...new Set([...group.images, ...configuration.images])];
        if (!group.main_image) group.main_image = configuration.main_image || configuration.images?.[0] || "";
        grouped.set(color, group);
      });
      const colorValues = savedVariants.find((row) => row.key === productPrimaryOptionKey)?.value.split(/[,|]/).map((value) => value.trim()).filter(Boolean) || [];
      const specValues = savedVariants.filter((row) => row.key !== productPrimaryOptionKey).flatMap((row) => row.value.split(/[,|]/).map((value) => value.trim()).filter(Boolean));
      const productSecondaryOptionKey = productOptionKeys[1] || "Variant";
      const loadedGroups = grouped.size ? [...grouped.values()].map(({ priceValues, ...group }) => ({ ...group, images: group.images.length ? group.images : savedGallery, main_image: group.main_image || product.image_url || savedGallery[0] || "", sharedPrice: new Set(priceValues).size === 1 && priceValues[0] ? priceValues[0] : "" })) : (colorValues.length ? colorValues : [""]).map((color) => ({ colorKey: productPrimaryOptionKey, specKey: productSecondaryOptionKey, color, sharedPrice: "", images: savedGallery, main_image: product.image_url || savedGallery[0] || "", subvariants: (specValues.length ? specValues : [""]).map((spec) => ({ spec })) }));
      setColorVariantGroups(loadedGroups);
      setVariantConfigurations(savedConfigurations.length
        ? Object.fromEntries(savedConfigurations.map((configuration) => {
          const rowMrp = configuration.original_price ?? configuration.price ?? product.price;
          const inheritedOffer = configuration.original_price == null && product.discount_price != null && product.discount_price < product.price && Number(configuration.price ?? product.price) === Number(product.price) ? product.discount_price : null;
          return [combinationKey(configuration.options || {}), { ...configuration, original_price: rowMrp, price: inheritedOffer ?? configuration.price ?? rowMrp }];
        }))
        : Object.fromEntries(expandVariantCombinations(savedVariants).map((options) => [combinationKey(options), { options, images: savedGallery, main_image: product.image_url || savedGallery[0] || "", price: "" }])));
      setSpecs([...productDetailsByKey.values()]);
      setHighlights(Array.isArray(product.highlights) && product.highlights.length ? product.highlights : [""]);
      setImages(savedGallery);
    }
    setModalTab("general");
    setIsModalOpen(true);
  };

  const handleResetProductForm = () => {
    if (editingProductId) {
      const savedProduct = products.find((product) => product.id === editingProductId);
      if (!savedProduct) {
        notify("Could not reload the saved product. Refresh the dashboard and try again.");
        return;
      }
      openProductEditor(savedProduct);
      notify("Unsaved edits were reset to the saved product.");
      return;
    }

    const categoryName = categories[0]?.name || "Electronics";
    const category = categories.find((item) => item.name === categoryName);
    const optionKeys = getCategoryVariantKeys(categoryName, category?.specifications);
    const details = (category?.specifications || [])
      .filter((key) => !isCategoryVariantField(categoryName, key, optionKeys) && !/^brand$/i.test(key))
      .map((key) => ({ key, value: "" }));
    try { localStorage.removeItem(`nexcart_product_draft_${vendorId}`); } catch { /* storage may be unavailable */ }
    setForm({ name: "", brand: "", sku: "", category_name: categoryName, subcategory: "", description: "", price: "", discount_price: "", cost_price: "", stock: "", low_stock_threshold: "5", weight: "", dimensions: "" });
    setImages([]);
    setVariantConfigurations({});
    setColorImageUrlInputs({});
    setPreviewImageUrl("");
    setColorVariantGroups([{ colorKey: optionKeys[0] || "Color", specKey: optionKeys[1] || "Variant", color: "", sharedPrice: "", images: [], main_image: "", subvariants: [{ spec: "" }] }]);
    setSpecs(details);
    setHighlights(["", ""]);
    setShowPreview(false);
    setModalTab("general");
    notify("Product form reset.");
  };

  // Load live marketplace data
  const fetchVendorData = async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      if (!vendorId) return;
      const [prodRes, catRes, ordRes, analyticsRes, profileRes] = await Promise.all([
        axios.get(`http://127.0.0.1:8000/vendor/${vendorId}/products`, { headers }),
        axios.get("http://127.0.0.1:8000/vendor/categories").catch(() => ({ data: [] })),
        axios.get(`http://127.0.0.1:8000/vendor/${vendorId}/orders`, { headers }).catch(() => ({ data: [] })),
        axios.get(`http://127.0.0.1:8000/vendor/${vendorId}/analytics`, { headers }).catch(() => ({ data: {} })),
        axios.get(`http://127.0.0.1:8000/vendor/${vendorId}/profile`, { headers }).catch(() => ({ data: {} })),
      ]);
      setProducts(prodRes.data || []);
      if (catRes.data && catRes.data.length > 0) {
        setCategories(catRes.data.map((category) => ({ ...category, specifications: category.specifications || category.specs || [] })));
      }

      setOrders(ordRes.data || []);
      setAnalytics(analyticsRes.data || {});
      if (profileRes.data.store_name) setStoreName(profileRes.data.store_name);
      setStoreBio(profileRes.data.store_bio || "");
      setStoreAddress(profileRes.data.store_address || "");
      setStoreLat(profileRes.data.store_lat ?? "");
      setStoreLng(profileRes.data.store_lng ?? "");
      setPayoutUpiId(profileRes.data.payout_upi_id || "");
    } catch (err) {
      console.error("Failed loading vendor data:", err);
    }
  };

  useEffect(() => {
    fetchVendorData();
    const timer = window.setInterval(fetchVendorData, 7000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    // `/vendor/dashboard` should always open on the dashboard tab. This also
    // corrects a stale tab selection preserved by the dev server during HMR.
    if (window.location.pathname === "/vendor/dashboard") setActiveNav("dashboard");
  }, []);

  useEffect(() => {
    if (activeNav === "analytics") setActiveNav("dashboard");
  }, [activeNav]);

  const markPacked = async (order) => {
    if (packingOrderId === order.order_id) return;
    setPackingOrderId(order.order_id);
    try {
      const response = await axios.patch(`http://127.0.0.1:8000/vendor/orders/${order.order_id}/pack`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchVendorData();
      notify(response.data.all_vendors_packed
        ? "Order ready for pickup. Assign a rider in Delivery Operations so they can accept it."
        : "Your items are packed. The order becomes ready after every seller packs their items.");
    } catch (error) {
      const serverMessage = error.response?.data?.detail || error.response?.data?.message;
      const failureMessage = serverMessage
        || (error.response
          ? `Packing failed (${error.response.status}). Check the backend terminal for the error.`
          : `The request to 127.0.0.1:8000 was blocked or failed. Check the API terminal and browser Console for a CORS or connection error.`);
      notify(failureMessage);
    } finally {
      setPackingOrderId(null);
    }
  };

  // Category Change -> Populate Default Spec Keys
  const remapVariantKeys = (nextPrimaryKey, nextSecondaryKey) => {
    const previousGroup = colorVariantGroups[0];
    const previousPrimaryKey = previousGroup?.colorKey || "Color";
    const previousSecondaryKey = previousGroup?.specKey || "Variant";
    setVariantConfigurations((current) => Object.values(current).reduce((next, configuration) => {
      const options = { ...(configuration.options || {}) };
      const remapped = {};
      Object.entries(options).forEach(([key, value]) => {
        remapped[key === previousPrimaryKey ? nextPrimaryKey : key === previousSecondaryKey ? nextSecondaryKey : key] = value;
      });
      const updated = { ...configuration, options: remapped };
      next[combinationKey(remapped)] = updated;
      return next;
    }, {}));
  };

  const handleCategoryChange = (catName) => {
    setForm((p) => ({ ...p, category_name: catName, subcategory: "" }));
    const found = categories.find((c) => c.name === catName);
    const optionKeys = getCategoryVariantKeys(catName, found?.specifications);
    const nextPrimaryKey = optionKeys[0] || "Color";
    const nextSecondaryKey = optionKeys[1] || "Variant";
    remapVariantKeys(nextPrimaryKey, nextSecondaryKey);
    setColorVariantGroups((current) => current.map((group) => ({ ...group, colorKey: nextPrimaryKey, specKey: nextSecondaryKey })));
    if (found && Array.isArray(found.specifications)) {
      const suggestedRows = found.specifications.map((key) => ({ key, value: "" }));
      setSpecs(suggestedRows.filter((row) => !isCategoryVariantField(catName, row.key, optionKeys) && !/^brand$/i.test(row.key)));
    }
  };

  const handleSubcategoryChange = (subcategory) => {
    setForm((previous) => ({ ...previous, subcategory }));
    if (/shoe/i.test(subcategory)) {
      remapVariantKeys("Color", "Size");
      setColorVariantGroups((current) => current.map((group) => ({ ...group, colorKey: "Color", specKey: "Size" })));
      setSpecs(["Material", "Gender", "Sole Material", "Closure Type"].map((key) => ({ key, value: "" })));
    }
  };

  // Each primary option group owns one gallery shared by its secondary options.
  const handleColorPhotoUpload = async (e, groupIndex) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingImg(true);
    const uploadedImages = [];
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await axios.post("http://127.0.0.1:8000/vendor/upload-image", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (res.data?.url) uploadedImages.push(res.data.url);
      } catch {
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result || "");
          reader.onerror = () => resolve("");
          reader.readAsDataURL(file);
        });
        if (dataUrl) uploadedImages.push(dataUrl);
      }
    }
    setColorVariantGroups((prev) => prev.map((group, index) => {
      if (index !== groupIndex) return group;
      const images = [...new Set([...(group.images || []), ...uploadedImages])];
      return { ...group, images, main_image: group.main_image || images[0] || "" };
    }));
    e.target.value = "";
    setUploadingImg(false);
  };

  const handleAddColorPhotoUrl = (groupIndex) => {
    const imageUrl = (colorImageUrlInputs[groupIndex] || "").trim();
    if (!imageUrl) return;
    setColorVariantGroups((prev) => prev.map((group, index) => {
      if (index !== groupIndex) return group;
      const images = [...new Set([...(group.images || []), imageUrl])];
      return { ...group, images, main_image: group.main_image || images[0] };
    }));
    setColorImageUrlInputs((prev) => ({ ...prev, [groupIndex]: "" }));
  };

  const removeColorPhoto = (groupIndex, imageUrl) => {
    setColorVariantGroups((prev) => prev.map((group, index) => {
      if (index !== groupIndex) return group;
      const images = (group.images || []).filter((image) => image !== imageUrl);
      return { ...group, images, main_image: group.main_image === imageUrl ? (images[0] || "") : group.main_image };
    }));
  };

  const updateColorGroupName = (groupIndex, color) => {
    const group = colorVariantGroups[groupIndex];
    if (!group) return;
    setVariantConfigurations((prev) => {
      const next = { ...prev };
      (group.subvariants || []).forEach((subvariant) => {
        const oldOptions = buildColorVariantOptions(group.color, subvariant.spec, group.colorKey, group.specKey);
        const newOptions = buildColorVariantOptions(color, subvariant.spec, group.colorKey, group.specKey);
        const oldKey = combinationKey(oldOptions);
        const newKey = combinationKey(newOptions);
        if (oldKey !== newKey && next[oldKey]) {
          next[newKey] = { ...next[oldKey], options: newOptions };
          delete next[oldKey];
        }
      });
      return next;
    });
    setColorVariantGroups((prev) => prev.map((item, index) => index === groupIndex ? { ...item, color } : item));
  };

  const updateColorSubvariant = (groupIndex, subvariantIndex, spec) => {
    const group = colorVariantGroups[groupIndex];
    const subvariant = group?.subvariants?.[subvariantIndex];
    if (!group || !subvariant) return;
    const oldOptions = buildColorVariantOptions(group.color, subvariant.spec, group.colorKey, group.specKey);
    const newOptions = buildColorVariantOptions(group.color, spec, group.colorKey, group.specKey);
    setVariantConfigurations((prev) => {
      const next = { ...prev };
      const oldKey = combinationKey(oldOptions);
      const newKey = combinationKey(newOptions);
      if (oldKey !== newKey && next[oldKey]) {
        next[newKey] = { ...next[oldKey], options: newOptions };
        delete next[oldKey];
      }
      return next;
    });
    setColorVariantGroups((prev) => prev.map((item, index) => index === groupIndex ? { ...item, subvariants: item.subvariants.map((option, optionIndex) => optionIndex === subvariantIndex ? { ...option, spec } : option) } : item));
  };

  const addCommonApparelSizes = (groupIndex) => {
    const group = colorVariantGroups[groupIndex];
    if (!group) return;
    const filledRows = group.subvariants.filter((option) => option.spec.trim());
    const existing = new Set(filledRows.map((option) => option.spec.trim().toUpperCase()));
    const commonSizes = ["S", "M", "L", "XL", "XXL"].filter((size) => !existing.has(size));
    const nextRows = [...filledRows, ...commonSizes.map((spec) => ({ spec }))];
    const sourceRow = group.subvariants.find((option) => !option.spec.trim());
    const sourceOptions = buildColorVariantOptions(group.color, "", group.colorKey, group.specKey);
    const sourceConfiguration = sourceRow ? variantConfigurations[combinationKey(sourceOptions)] : null;
    if (sourceConfiguration && commonSizes.length) {
      setVariantConfigurations((current) => {
        const next = { ...current };
        commonSizes.forEach((size) => {
          const options = buildColorVariantOptions(group.color, size, group.colorKey, group.specKey);
          next[combinationKey(options)] = { ...sourceConfiguration, options };
        });
        return next;
      });
    }
    setColorVariantGroups((current) => current.map((item, index) => index === groupIndex
      ? { ...item, subvariants: nextRows.length ? nextRows : [{ spec: "" }] }
      : item));
  };

  const handleSaveProgress = () => {
    const draft = { form, images, variantConfigurations, colorVariantGroups, specs, highlights, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(`nexcart_product_draft_${vendorId}`, JSON.stringify(draft));
      notify("Progress saved on this device. It will be restored when you add a product.");
    } catch {
      notify("Could not save progress. Check available browser storage.");
    }
  };

  // Submit product listing
  const handlePublishProduct = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.category_name.trim()) {
      setModalTab("general");
      notify("Add the product name and choose a category in Product info.");
      return;
    }
    if (form.stock === "" || !Number.isInteger(Number(form.stock)) || Number(form.stock) < 0) {
      setModalTab("details");
      notify("Enter a valid stock quantity in Details & stock.");
      return;
    }
    if (colorVariantGroups.some((group) => ((group.subvariants || []).some((item) => item.spec.trim()) || group.images?.length) && !group.color.trim())) {
      setModalTab("variants");
      notify(`Enter a ${primaryOptionKey.toLowerCase()} name for each variant group before saving.`);
      return;
    }
    const specsObj = {};
    specs.forEach((row) => {
      if (!row.key.trim() || !row.value.trim()) return;
      specsObj[row.key.trim()] = row.value.trim();
    });
    if (form.subcategory.trim()) specsObj.Subcategory = form.subcategory.trim();
    if (form.dimensions.trim()) specsObj["Shipping dimensions"] = form.dimensions.trim();
    const cleanHighlights = highlights.map((h) => h.trim()).filter(Boolean);
    const groupsToSave = colorVariantGroups.length ? colorVariantGroups : [{ colorKey: primaryOptionKey, specKey: secondaryOptionKey, color: "", sharedPrice: "", subvariants: [{ spec: "" }] }];
    const flattenedVariants = groupsToSave.flatMap((group) => {
      const rows = group.subvariants?.length ? group.subvariants : [{ spec: "" }];
      const filledRows = rows.filter((row) => row.spec?.trim());
      return (filledRows.length ? filledRows : rows.slice(0, 1)).map((subvariant) => {
        const colorKey = group.colorKey || primaryOptionKey;
        const options = {};
        if (group.color?.trim()) options[colorKey] = group.color.trim();
        if (subvariant.spec?.trim()) options[group.specKey || secondaryOptionKey] = subvariant.spec.trim();
        return { options, sharedPrice: group.sharedPrice, groupImages: group.images || [], groupMainImage: group.main_image || "" };
      });
    });
    const invalidVariantPrice = flattenedVariants.find(({ options }) => {
      const configuration = variantConfigurations[combinationKey(options)] || {};
      const hasVariant = Object.values(options).some(Boolean);
      const hasPrice = configuration.original_price || configuration.price || "";
      return (hasVariant && Number(configuration.original_price || 0) <= 0)
        || (configuration.price !== "" && configuration.price != null && Number(configuration.price) <= 0)
        || (hasPrice && Number(configuration.price || configuration.original_price) > Number(configuration.original_price || configuration.price));
    });
    if (invalidVariantPrice) {
      setModalTab("variants");
      notify("Enter a valid MRP for every option row. Selling price must be above zero and cannot exceed MRP.");
      return;
    }
    const colorChoices = [...new Set(groupsToSave.map((group) => group.color?.trim()).filter(Boolean))];
    const specChoices = [...new Set(groupsToSave.flatMap((group) => (group.subvariants || []).map((subvariant) => subvariant.spec?.trim()).filter(Boolean)))];
    if (colorChoices.length) specsObj[groupsToSave.find((group) => group.color?.trim())?.colorKey || "Color"] = colorChoices;
    if (specChoices.length) specsObj[groupsToSave.find((group) => group.specKey)?.specKey || secondaryOptionKey] = specChoices;
    const variantConfigurationsPayload = flattenedVariants.map(({ options, sharedPrice, groupImages, groupMainImage }) => {
      const configuration = variantConfigurations[combinationKey(options)] || {};
      const selectedImages = [...new Set(groupImages)];
      const preferredMainImage = groupMainImage || configuration.main_image;
      const mainImage = selectedImages.includes(preferredMainImage) ? preferredMainImage : selectedImages[0] || "";
      const mrp = configuration.original_price === "" || configuration.original_price == null ? (configuration.price || sharedPrice || "") : configuration.original_price;
      const offerPrice = configuration.price === "" || configuration.price == null ? (sharedPrice || mrp) : configuration.price;
      return { options, price: offerPrice === "" || offerPrice == null ? null : Number(offerPrice), original_price: mrp === "" ? null : Number(mrp), main_image: mainImage, images: selectedImages };
    });
    const pricedVariant = variantConfigurationsPayload.find((configuration) => Number(configuration.original_price || configuration.price) > 0);
    if (!pricedVariant) {
      setModalTab("variants");
      notify("Add an MRP for at least one option before submitting.");
      return;
    }
    const combinationGallery = [...new Set(variantConfigurationsPayload.flatMap((configuration) => configuration.images))];
    const productGallery = [...new Set([...images, ...combinationGallery])];
    const productCover = images[0] || variantConfigurationsPayload.find((configuration) => configuration.main_image)?.main_image || productGallery[0] || "";

    setSubmitting(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
          name: form.name.trim(),
          brand: form.brand.trim(),
          sku: form.sku.trim(),
          category_name: form.category_name,
          description: form.description.trim(),
          price: Number(pricedVariant.original_price || pricedVariant.price),
          discount_price: Number(pricedVariant.price) < Number(pricedVariant.original_price) ? Number(pricedVariant.price) : null,
          stock: parseInt(form.stock, 10),
          low_stock_threshold: parseInt(form.low_stock_threshold || "5", 10),
          cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
          weight: form.weight.trim(),
          image_url: productCover,
          gallery_images: productGallery,
          specifications: specsObj,
          variant_images: {},
          variant_configurations: variantConfigurationsPayload,
          highlights: cleanHighlights,
        };
      if (editingProductId) {
        await axios.put(`http://127.0.0.1:8000/vendor/products/${editingProductId}`, payload, { headers });
      } else {
        await axios.post("http://127.0.0.1:8000/vendor/products", payload, { headers });
      }

      notify(editingProductId ? "Product changes saved." : "Product submitted and awaiting Admin approval!");
      if (!editingProductId) localStorage.removeItem(`nexcart_product_draft_${vendorId}`);
      setIsModalOpen(false);
      setEditingProductId(null);
      setModalTab("general");
      setForm({
        name: "",
        brand: "",
        sku: "",
        category_name: "Electronics",
        subcategory: "",
        description: "",
        price: "",
        discount_price: "",
        cost_price: "",
        stock: "",
        low_stock_threshold: "5",
        weight: "",
        dimensions: "",
      });
      setImages([]);
      setVariantConfigurations({});
      setColorVariantGroups([{ colorKey: "Color", specKey: "Variant", color: "", sharedPrice: "", subvariants: [{ spec: "" }] }]);
      setSpecs([]);
      setHighlights(["", ""]);
      fetchVendorData();
    } catch (err) {
      console.error("Product submission failed:", err.response?.data || err);
      const detail = err.response?.data?.detail;
      notify(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : (err.message || "Could not submit the product. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("nexcart_vendor_token");
    localStorage.removeItem("nexcart_vendor_store");
    navigate("/vendor/login");
  };

  const saveStoreSettings = async (event) => {
    event.preventDefault();
    try {
      await axios.put(`http://127.0.0.1:8000/vendor/${vendorId}/profile`, {
        store_name: storeName, store_bio: storeBio, payout_upi_id: payoutUpiId,
        store_address: storeAddress, store_lat: storeLat === "" ? null : Number(storeLat), store_lng: storeLng === "" ? null : Number(storeLng),
      }, { headers: { Authorization: `Bearer ${token}` } });
      localStorage.setItem("nexcart_store_name", storeName);
      notify("Store settings saved.");
    } catch (error) { notify(error.response?.data?.detail || "Could not save store settings."); }
  };

  const captureStoreLocation = () => {
    if (!navigator.geolocation) return notify("This browser does not support location access.");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setStoreLat(String(coords.latitude)); setStoreLng(String(coords.longitude)); notify("Pickup map pin captured. Save changes to publish it."); },
      () => notify("Allow location access or enter the pickup coordinates manually."),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  // Compute live marketplace metrics
  const activeListingsCount = products.filter((p) => p.status === "Approved").length;
  const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= 5).length;
  const outOfStockCount = products.filter((p) => p.stock === 0).length;
  const inStockCount = products.filter((p) => p.stock > 5).length;
  const totalGmv = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const salesTrend = Array.from({ length: 6 }, (_, index) => {
    const month = new Date();
    month.setDate(1);
    month.setHours(0, 0, 0, 0);
    month.setMonth(month.getMonth() - 5 + index);
    const nextMonth = new Date(month);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const amount = orders.reduce((sum, order) => {
      const created = order.created_at ? new Date(order.created_at) : null;
      if (!created || created < month || created >= nextMonth) return sum;
      return sum + Number(order.total ?? order.total_amount ?? 0);
    }, 0);
    return { label: month.toLocaleDateString("en-IN", { month: "short" }), amount };
  });
  const trendMax = Math.max(1, ...salesTrend.map((point) => point.amount));
  const chartPoints = salesTrend.map((point, index) => ({
    ...point,
    x: 42 + index * 103.2,
    y: 174 - (point.amount / trendMax) * 120,
  }));
  const linePath = chartPoints.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const areaPath = `${linePath} L558,180 L42,180 Z`;
  const inventoryStats = [
    { label: "Active listings", value: activeListingsCount, tone: "blue" },
    { label: "Low stock", value: lowStockCount, tone: "sage" },
    { label: "Out of stock", value: outOfStockCount, tone: "amber" },
    { label: "Pending approval", value: products.filter((product) => product.status === "Pending").length, tone: "lavender" },
  ];

  // Filtered Products
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.sku || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.brand || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "All Categories" || p.category === categoryFilter;
    const matchesStock =
      stockTab === "all" ||
      (stockTab === "instock" && p.stock > 5) ||
      (stockTab === "low" && p.stock > 0 && p.stock <= 5) ||
      (stockTab === "out" && p.stock === 0);
    return matchesSearch && matchesCategory && matchesStock;
  });

  // Pricing preview for the first configured variant row.
  const previewGroup = colorVariantGroups[0];
  const previewSubvariant = previewGroup?.subvariants?.[0];
  const previewOptions = previewGroup ? buildColorVariantOptions(previewGroup.color, previewSubvariant?.spec, previewGroup.colorKey, previewGroup.specKey) : {};
  const previewConfiguration = variantConfigurations[combinationKey(previewOptions)] || {};
  const previewMrp = Number(previewConfiguration.original_price || form.price || 0);
  const previewPrice = Number(previewConfiguration.price || previewConfiguration.original_price || form.discount_price || form.price || 0);
  const previewDiscountPct = previewMrp > previewPrice && previewMrp > 0 ? Math.round(((previewMrp - previewPrice) / previewMrp) * 100) : 0;
  const previewImages = [...new Set([...images, ...colorVariantGroups.flatMap((group) => group.images || [])])];

  return (
    <div className="vendor-shell min-h-screen bg-[#f8f9ff] text-[#0b1c30] font-['Inter',sans-serif]">
      {/* Toast Notification */}
      {toast && (
        <div role="status" aria-live="polite" className="vendor-toast fixed bottom-6 right-6 z-[120] bg-[#0b1c30] text-white px-5 py-3.5 rounded-xl shadow-xl flex items-center gap-2.5 text-[13px] font-semibold">
          <span className="material-symbols-outlined text-[#68dba9] text-[20px]">check_circle</span>
          <span>{toast}</span>
        </div>
      )}

      {/* Left Fixed Sidebar */}
      <aside className="vendor-sidebar fixed left-0 top-0 h-full w-64 bg-white z-40 flex flex-col justify-between">
        <div className="flex flex-col">
          {/* Brand Logo */}
          <div className="vendor-brand h-16 px-6 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#006948] flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[20px]">storefront</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[16px] font-bold tracking-tight leading-none text-[#0b1c30]">NexCart</span>
              <span className="text-[11px] font-semibold text-[#6d7a72] uppercase tracking-wider mt-0.5">Seller Center</span>
            </div>
          </div>

          {/* Store Status Pill */}
          <div className="px-4 py-2">
            <div className="vendor-store-live flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#eff4ff]">
              <span className="w-2 h-2 rounded-full bg-[#00855d] animate-pulse"></span>
              <span className="text-[11px] font-semibold text-[#3d4a42] truncate">Store Live &amp; Accepting</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="vendor-nav flex flex-col gap-1 px-4 mt-2">
            {[
              { id: "dashboard", icon: "dashboard", label: "Dashboard" },
              { id: "products-inventory", icon: "inventory_2", label: "Products & Inventory" },
              { id: "orders", icon: "shopping_cart", label: "Orders" },
              { id: "store-settings", icon: "settings", label: "Store Settings" },
            ].map((item) => {
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  className={`vendor-nav-link flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] transition-colors text-left ${
                    active
                      ? "is-active bg-[#dce9ff] text-[#006948] font-semibold"
                      : "text-[#3d4a42] hover:bg-[#e5eeff] hover:text-[#0b1c30] font-medium"
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Merchant Footer Card */}
        <div className="vendor-sidebar-footer p-4 space-y-2">
          <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#eff4ff]">
            <div className="w-8 h-8 rounded-full bg-[#006948] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-white text-[18px]">person</span>
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-[#0b1c30] truncate">{storeName}</span>
              <span className="text-[11px] text-[#3d4a42] truncate">{vendorName}</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold text-[#ba1a1a] bg-[#ffdad6]/50 hover:bg-[#ffdad6] transition-colors"
          >
            <span className="material-symbols-outlined text-[17px]">logout</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="vendor-main pl-64">
        {/* Top Fixed Header */}
        <header className="vendor-topbar fixed top-0 left-64 right-0 h-16 bg-white/90 backdrop-blur-xl z-30 flex items-center justify-between px-6">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <div className="relative w-full">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#3d4a42] text-[20px]">search</span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-lg bg-[#eff4ff] text-[12.5px] text-[#0b1c30] placeholder:text-[#3d4a42] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#006948]/20 transition-all"
                placeholder="Search orders, SKU, customer or catalog..."
                type="text"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <NotificationBell role="vendor" userId={vendorId} />
            <div className="hidden xl:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#eff4ff]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#006948] animate-pulse"></span>
              <span className="text-[11px] font-semibold text-[#0b1c30]">Store Live &amp; Accepting Orders</span>
            </div>

            <button
              onClick={() => {
                openProductEditor();
              }}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#006948] hover:bg-[#00855d] text-white text-[13px] font-semibold transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Add Product</span>
            </button>

            <div className="h-8 w-px bg-[#d3e4fe]"></div>

            <div className="flex items-center gap-2.5">
              <div className="flex flex-col text-right hidden sm:flex">
                <span className="text-[13px] font-semibold text-[#0b1c30] leading-tight">{storeName}</span>
                <span className="text-[11px] text-[#6d7a72] leading-tight">Verified Merchant</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-[#006948] flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-[18px]">person</span>
              </div>
            </div>
          </div>
        </header>

        {/* Workspace Body */}
        <main className="vendor-workspace w-full pt-24 px-6 pb-12">
          {activeNav === "dashboard" && (
            <section className="vendor-dashboard-view space-y-6">
              <div className="vendor-page-heading"><p className="text-[11px] uppercase tracking-wider text-[#006948] font-bold">Store overview</p><h1 className="text-[28px] font-bold text-[#0b1c30]">Welcome back, {vendorName}</h1><p className="text-[14px] text-[#3d4a42] mt-1">Here’s how {storeName} is doing today.</p></div>
              <div className="vendor-stat-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[["Active listings", activeListingsCount], ["Orders", orders.length], ["Sales", `₹${Number(analytics.total_sales || totalGmv).toLocaleString("en-IN")}`], ["Needs attention", lowStockCount + products.filter((p) => p.status === "Pending").length]].map(([label, value]) => <article key={label} className="rounded-xl bg-white p-5 shadow-sm"><p className="text-[12px] font-semibold text-[#6d7a72]">{label}</p><strong className="mt-2 block text-[26px] text-[#0b1c30]">{value}</strong></article>)}
              </div>
              <div className="vendor-dashboard-charts">
                <section className="vendor-chart-card vendor-sales-chart">
                  <div className="vendor-chart-heading"><div><span>STORE PERFORMANCE</span><h2>Sales trend</h2><p>Monthly order revenue for the last six months.</p></div><strong>₹{Number(analytics.total_sales || totalGmv).toLocaleString("en-IN")}</strong></div>
                  <svg className="vendor-sales-svg" viewBox="0 0 600 210" role="img" aria-label="Sales trend over the last six months">
                    <defs><linearGradient id="vendor-sales-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0b57d0" stopOpacity=".22"/><stop offset="100%" stopColor="#0b57d0" stopOpacity="0"/></linearGradient></defs>
                    {[40, 80, 120, 160].map((y) => <line key={y} x1="42" x2="558" y1={y} y2={y} className="vendor-chart-gridline"/>)}
                    <path d={areaPath} fill="url(#vendor-sales-fill)" />
                    <path d={linePath} className="vendor-sales-line" />
                    {chartPoints.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="4.5" className="vendor-sales-dot"><title>{point.label}: ₹{point.amount.toLocaleString("en-IN")}</title></circle>)}
                  </svg>
                  <div className="vendor-chart-months">{salesTrend.map((point) => <span key={point.label}>{point.label}</span>)}</div>
                </section>
                <section className="vendor-chart-card vendor-inventory-chart">
                  <div className="vendor-chart-heading"><div><span>CATALOG HEALTH</span><h2>Inventory overview</h2><p>{products.length} products in your catalog.</p></div><span className="vendor-inventory-icon material-symbols-outlined">inventory_2</span></div>
                  <div className="vendor-inventory-stat-list">{inventoryStats.map((item) => <div className="vendor-inventory-stat" key={item.label}>
                    <div className="vendor-inventory-stat-label"><span><i className={`vendor-stat-key ${item.tone}`} />{item.label}</span><strong>{item.value}</strong></div>
                    <div className="vendor-stat-track"><span className={item.tone} style={{ width: `${products.length ? Math.max(5, item.value / products.length * 100) : 0}%` }} /></div>
                  </div>)}</div>
                </section>
              </div>
              <section className="vendor-panel vendor-recent-orders rounded-xl bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-[#0b1c30]">Recent orders</h2><button onClick={() => setActiveNav("orders")} className="text-[12px] font-semibold text-[#006948]">View all</button></div>{orders.length === 0 ? <p className="text-[13px] text-[#6d7a72]">No orders yet. New store orders will appear here.</p> : <div className="space-y-3">{orders.slice(0, 5).map((order) => <div key={order.id} className="vendor-recent-row flex flex-wrap items-center justify-between gap-2 border-t border-[#eff4ff] pt-3 text-[13px]"><span className="font-semibold">{order.order_number} · {order.product_name}</span><span>{order.customer_name}</span><span>₹{Number(order.total || 0).toLocaleString("en-IN")}</span><span className="rounded-full bg-[#eff4ff] px-2.5 py-1 text-[11px]">{order.status}</span></div>)}</div>}</section>
            </section>
          )}

          {activeNav === "orders" && <section className="rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-5"><p className="text-[11px] uppercase tracking-wider text-[#006948] font-bold">Store management</p><h1 className="text-[25px] font-bold text-[#0b1c30]">Orders</h1><p className="text-[13px] text-[#6d7a72]">Order items, customer contact information, and delivery address for your store.</p></div>
            {orders.length === 0 ? <p className="text-[13px] text-[#6d7a72]">No orders yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1450px] text-left text-[13px]"><thead className="bg-[#eff4ff] text-[11px] uppercase text-[#3d4a42]"><tr>{["Order", "Product", "Customer details", "Customer history", "Delivery address", "Qty", "Total", "Status", "Date", "Action"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b border-[#eff4ff]"><td className="px-3 py-3 font-semibold">{order.order_number}</td><td className="px-3 py-3"><div>{order.product_name}{Object.keys(order.variant_options || {}).length > 0 && <span className="mt-1 block text-[11px] text-[#64748b]">{Object.entries(order.variant_options).map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>}</div></td><td className="px-3 py-3"><div className="min-w-[180px]"><strong className="block text-[#0b1c30]">{order.customer_name}</strong><span className="mt-1 block text-[11px] text-[#64748b]">{order.customer_email || "Email unavailable"}</span><span className="block text-[11px] text-[#64748b]">{order.customer_phone || "Phone unavailable"}</span><span className="block text-[10px] text-[#8a8494]">Customer #{order.customer_id ?? "—"}</span></div></td><td className="px-3 py-3"><div className="min-w-[150px]"><span className="block font-semibold text-[#0b1c30]">{order.customer_store_order_count ?? 0} orders with your store</span><span className="mt-1 block text-[11px] text-[#64748b]">₹{Number(order.customer_store_spent || 0).toLocaleString("en-IN")} spent</span><span className="block text-[11px] text-[#64748b]">Joined {order.customer_joined ? new Date(order.customer_joined).toLocaleDateString() : "—"}</span><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${order.customer_is_active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{order.customer_is_active ? "Active" : "Inactive"}</span></div></td><td className="px-3 py-3"><span className="block max-w-[240px] whitespace-normal text-[12px] leading-relaxed text-[#475569]">{order.shipping_address || "Address unavailable"}</span></td><td className="px-3 py-3">{order.quantity}</td><td className="px-3 py-3 font-semibold">₹{Number(order.total || 0).toLocaleString("en-IN")}</td><td className="px-3 py-3"><span className="rounded-full bg-[#eff4ff] px-2.5 py-1 text-[11px] font-semibold">{order.status}</span></td><td className="px-3 py-3">{order.created_at ? new Date(order.created_at).toLocaleDateString() : "—"}</td><td className="px-3 py-3">{order.order_status === "Processing" && order.status === "Processing" && <button type="button" disabled={packingOrderId === order.order_id} onClick={() => markPacked(order)} className="whitespace-nowrap rounded-lg bg-[#006948] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#00855d] disabled:cursor-wait disabled:opacity-60">{packingOrderId === order.order_id ? "Saving…" : "Mark Packed & Ready"}</button>}</td></tr>)}</tbody></table></div>}
          </section>}

          {activeNav === "store-settings" && <section className="vendor-settings-page">
            <header className="vendor-settings-hero">
              <div className="vendor-settings-hero-icon"><span className="material-symbols-outlined">storefront</span></div>
              <div><span className="vendor-settings-eyebrow">SELLER CENTER</span><h1>Store settings</h1><p>Manage your public store profile and payout destination.</p></div>
              <span className="vendor-settings-live"><i /> Store is live</span>
            </header>
            <div className="vendor-settings-layout">
              <form onSubmit={saveStoreSettings} className="vendor-settings-form">
                <div className="vendor-settings-card-heading"><div><h2>Store profile</h2><p>These details help customers recognize your business.</p></div><span className="material-symbols-outlined">edit_square</span></div>
                <label className="vendor-settings-field"><span>Store name</span><input value={storeName} onChange={(e) => setStoreName(e.target.value)} required placeholder="Your store name"/><small>Shown to customers across the marketplace.</small></label>
                <label className="vendor-settings-field"><span>Store description</span><textarea value={storeBio} onChange={(e) => setStoreBio(e.target.value)} rows={5} placeholder="Tell customers what your store offers"/><small>A short introduction helps customers understand your store.</small></label>
                <div className="vendor-settings-divider" />
                <div className="vendor-settings-card-heading"><div><h2>Pickup location</h2><p>Riders use this address and map pin to navigate to your store.</p></div><span className="material-symbols-outlined">location_on</span></div>
                <label className="vendor-settings-field"><span>Pickup address</span><textarea value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} rows={3} placeholder="Street, area, city, state, PIN code"/><small>Use the full address riders should visit to collect orders.</small></label>
                <div className="vendor-settings-fields-row">
                  <label className="vendor-settings-field"><span>Pickup latitude</span><input type="number" step="any" value={storeLat} onChange={(e) => setStoreLat(e.target.value)} placeholder="e.g. 12.9716"/></label>
                  <label className="vendor-settings-field"><span>Pickup longitude</span><input type="number" step="any" value={storeLng} onChange={(e) => setStoreLng(e.target.value)} placeholder="e.g. 77.5946"/></label>
                </div>
                <button type="button" onClick={captureStoreLocation} className="vendor-store-location-button"><span className="material-symbols-outlined">my_location</span>Use this device's location for pickup</button>
                <div className="vendor-settings-divider" />
                <div className="vendor-settings-card-heading vendor-payout-heading"><div><h2>Payout details</h2><p>Set the UPI ID where marketplace earnings are sent.</p></div><span className="material-symbols-outlined">account_balance_wallet</span></div>
                <label className="vendor-settings-field"><span>Payout UPI ID</span><input value={payoutUpiId} onChange={(e) => setPayoutUpiId(e.target.value)} placeholder="name@upi"/><small>Keep this up to date to avoid payout delays.</small></label>
                <div className="vendor-settings-form-footer"><span className="vendor-settings-save-note"><span className="material-symbols-outlined">info</span>Changes apply after saving.</span><button type="submit"><span className="material-symbols-outlined">save</span>Save changes</button></div>
              </form>
              <aside className="vendor-settings-preview">
                <div className="vendor-preview-cover"><span className="material-symbols-outlined">store</span></div>
                <div className="vendor-preview-avatar"><span className="material-symbols-outlined">storefront</span></div>
                <div className="vendor-preview-content"><span className="vendor-preview-label">CUSTOMER VIEW</span><h2>{storeName || "Your store"}</h2><p>{storeBio || "Your store description will appear here once you add it."}</p><span className="vendor-preview-verified"><span className="material-symbols-outlined">verified</span> Verified seller</span></div>
                <div className="vendor-preview-note"><span className="material-symbols-outlined">tips_and_updates</span><span>Keep your profile clear and current so shoppers know what to expect.</span></div>
              </aside>
            </div>
          </section>}

          {activeNav === "products-inventory" && <>
          {/* Page Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px] uppercase tracking-wider text-[#006948] font-bold">Store Management</span>
                <span className="text-[#3d4a42]">•</span>
                <span className="text-[11px] text-[#3d4a42]">Live Sync</span>
              </div>
              <h1 className="text-[28px] font-bold text-[#0b1c30] tracking-tight">Vendor Dashboard &amp; Inventory Management</h1>
              <p className="text-[14px] text-[#3d4a42] mt-0.5">Manage your product listings, pricing, specifications, and live inventory across NexCart.</p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={fetchVendorData}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white text-[#0b1c30] text-[13px] font-semibold shadow-sm hover:bg-[#eff4ff] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                <span>Sync Catalog</span>
              </button>
              <button
                onClick={() => {
                  openProductEditor();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#006948] hover:bg-[#00855d] text-white text-[13px] font-semibold shadow-sm transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>+ Add Product</span>
              </button>
            </div>
          </div>

          {/* Top 4 marketplace KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-white shadow-sm flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-[#3d4a42]">Active Listings</span>
                  <div className="text-[28px] font-bold text-[#0b1c30] mt-1">{activeListingsCount}</div>
                </div>
                <div className="w-10 h-10 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#006948]">
                  <span className="material-symbols-outlined text-[22px]">storefront</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#eff4ff] text-[#006948]">
                  {products.length} Total
                </span>
                <span className="text-[12px] text-[#3d4a42]">Approved on Storefront</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white shadow-sm flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-[#3d4a42]">Low Stock Alert</span>
                  <div className="text-[28px] font-bold text-[#825100] mt-1">{lowStockCount} Items</div>
                </div>
                <div className="w-10 h-10 rounded-lg bg-[#dce9ff] flex items-center justify-center text-[#825100]">
                  <span className="material-symbols-outlined text-[22px]">notification_important</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-[#ffddb8] text-[#2a1700] font-semibold">
                  {outOfStockCount} Out of stock
                </span>
                <span className="text-[12px] text-[#3d4a42]">≤ 5 units left</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white shadow-sm flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-[#3d4a42]">Total Marketplace GMV</span>
                  <div className="text-[28px] font-bold text-[#0b1c30] mt-1">₹{totalGmv.toLocaleString("en-IN")}</div>
                </div>
                <div className="w-10 h-10 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#006948]">
                  <span className="material-symbols-outlined text-[22px]">payments</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#eff4ff] text-[#006948]">
                  {orders.length} Orders
                </span>
                <span className="text-[12px] text-[#3d4a42]">Live sales</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white shadow-sm flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-[#3d4a42]">Pending Approval</span>
                  <div className="text-[28px] font-bold text-[#0b1c30] mt-1">
                    {products.filter((p) => p.status === "Pending").length}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#825100]">
                  <span className="material-symbols-outlined text-[22px]">hourglass_top</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <span className="text-[12px] text-[#3d4a42]">Awaiting Admin verification</span>
              </div>
            </div>
          </div>

          {/* Catalog Filter Bar */}
          <div className="p-4 rounded-xl bg-white shadow-sm mb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative min-w-[260px] flex-1 max-w-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#3d4a42] text-[18px]">search</span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-9 pr-4 rounded-lg bg-[#eff4ff] text-[12.5px] text-[#0b1c30] focus:outline-none focus:bg-white transition-colors"
                  placeholder="Filter by product name, SKU, or brand..."
                  type="text"
                />
              </div>

              <div className="relative">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-10 pl-3 pr-8 rounded-lg bg-[#eff4ff] text-[12.5px] text-[#0b1c30] appearance-none focus:outline-none cursor-pointer font-medium"
                >
                  <option>All Categories</option>
                  {categories.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[#3d4a42] text-[18px] pointer-events-none">expand_more</span>
              </div>

              {/* Stock Status Tabs */}
              <div className="flex items-center bg-[#eff4ff] p-1 rounded-lg">
                {[
                  { id: "all", label: `All (${products.length})` },
                  { id: "instock", label: `In Stock (${inStockCount})` },
                  { id: "low", label: `Low Stock (${lowStockCount})` },
                  { id: "out", label: `Out of Stock (${outOfStockCount})` },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setStockTab(t.id)}
                    className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-all ${
                      stockTab === t.id ? "bg-white text-[#0b1c30] shadow-sm font-semibold" : "text-[#3d4a42] hover:text-[#0b1c30]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live vendor catalog table */}
          <div className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#eff4ff] text-[#3d4a42] text-[11px] font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Product</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Price &amp; Discount</th>
                    <th className="py-3 px-4">Stock Status</th>
                    <th className="py-3 px-4">Approval</th>
                    <th className="py-3 px-4 text-right">Specs</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff] text-[13px] text-[#0b1c30]">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-[#3d4a42]">
                        No products yet. Click <strong>+ Add Product</strong> to create your first listing with images and specs!
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => {
                      const hasDiscount = p.discount_price && p.discount_price < p.price;
                      const pct = hasDiscount ? Math.round(((p.price - p.discount_price) / p.price) * 100) : 0;
                      const specCount = p.specifications ? Object.keys(p.specifications).length : 0;

                      return (
                        <tr key={p.id} className="hover:bg-[#eff4ff]/50 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                className="w-12 h-12 rounded-lg object-cover bg-[#dce9ff] shrink-0 border border-[#d3e4fe]"
                                src={p.image_url || "https://placehold.co/96x96/eff4ff/006948?text=Item"}
                                alt={p.name}
                              />
                              <div className="flex flex-col min-w-0">
                                <span className="text-[14px] font-semibold text-[#0b1c30] truncate">{p.name}</span>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {p.brand && <span className="text-[11px] text-[#3d4a42] font-medium">{p.brand}</span>}
                                  {p.brand && <span className="text-[#3d4a42]">•</span>}
                                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#dce9ff] text-[#3d4a42]">
                                    {p.sku || `NX-${p.id}`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-medium">{p.category}</td>
                          <td className="py-3 px-4">
                            {hasDiscount ? (
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[#0b1c30]">₹{p.discount_price.toLocaleString("en-IN")}</span>
                                <span className="line-through text-[11.5px] text-[#6d7a72]">₹{p.price.toLocaleString("en-IN")}</span>
                                <span className="px-1.5 py-0.5 rounded bg-[#85f8c4] text-[#002114] text-[10.5px] font-bold">-{pct}%</span>
                              </div>
                            ) : (
                              <span className="font-bold text-[#0b1c30]">₹{p.price.toLocaleString("en-IN")}</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                p.stock === 0
                                  ? "bg-[#ffdad6] text-[#93000a]"
                                  : p.stock <= 5
                                  ? "bg-[#ffddb8] text-[#2a1700]"
                                  : "bg-[#eff4ff] text-[#006948]"
                              }`}
                            >
                              {p.stock === 0 ? "Out of Stock" : `${p.stock} in stock`}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                p.status === "Approved"
                                  ? "bg-[#85f8c4] text-[#002114]"
                                  : p.status === "Rejected"
                                  ? "bg-[#ffdad6] text-[#93000a]"
                                  : "bg-[#ffddb8] text-[#2a1700]"
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-[12px] text-[#3d4a42] font-medium">
                            {specCount} specs • {(p.gallery_images || []).length || (p.image_url ? 1 : 0)} photos
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button type="button" onClick={() => openProductEditor(p)} className="inline-flex items-center gap-1 rounded-lg bg-[#eff4ff] px-3 py-2 text-[11px] font-bold text-[#006948] hover:bg-[#dce9ff]">
                              <span className="material-symbols-outlined text-[15px]">edit</span>Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </>}
        </main>
      </div>

      {/* ===================================================================== */}
      {/* CENTERED PRODUCT STUDIO POP-UP (2 STEPS)                             */}
      {/* ===================================================================== */}
      {isModalOpen && (
        <div className="vendor-product-dialog-backdrop fixed inset-0 z-50 bg-[#0b1c30]/55 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsModalOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-product-title" className="vendor-product-dialog w-full max-w-3xl bg-white max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Sticky Header */}
            <div className="px-6 py-4 border-b border-[#eff4ff] bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#006948]">NexCart Catalog Studio</span>
                  <h2 id="add-product-title" className="text-[20px] font-bold text-[#0b1c30]">{editingProductId ? "Edit Product Listing" : "Add New Product Listing"}</h2>
                </div>
                <button type="button" onClick={() => setShowPreview((current) => !current)} className="mr-2 inline-flex items-center gap-1.5 rounded-lg border border-[#d7e3f4] bg-white px-3 py-2 text-[12px] font-semibold text-[#006948] hover:bg-[#eff4ff]"><span className="material-symbols-outlined text-[17px]">visibility</span>{showPreview ? "Back to editor" : "Preview listing"}</button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="w-9 h-9 rounded-lg bg-[#eff4ff] hover:bg-[#dce9ff] text-[#3d4a42] flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              {/* Product setup steps */}
              <div className="grid grid-cols-3 gap-1.5 bg-[#eff4ff] p-1 rounded-xl mt-4">
                {[
                  { id: "general", icon: "info", label: "Product info" },
                  { id: "variants", icon: "tune", label: "Variants & pricing" },
                  { id: "details", icon: "description", label: "Details & stock" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setModalTab(tab.id)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-[12px] font-semibold transition-all ${
                      modalTab === tab.id
                        ? "bg-white text-[#006948] shadow-sm"
                        : "text-[#3d4a42] hover:text-[#0b1c30]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Modal Scrollable Form Content */}
            {showPreview ? (
              <div className="flex-1 overflow-y-auto bg-[#f7f9fc] px-6 py-5">
                <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2">
                    <div className="bg-[#eff4ff]">
                      {previewImages.length ? <><img className="h-64 w-full object-cover" src={previewImageUrl || images[0] || previewImages[0]} alt={form.name || "Product preview"} />{previewImages.length > 1 && <div className="flex gap-2 overflow-x-auto p-3">{previewImages.map((image, index) => <button key={`${image}-${index}`} type="button" onClick={() => setPreviewImageUrl(image)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${((previewImageUrl || images[0] || previewImages[0]) === image) ? "border-[#006948]" : "border-transparent"}`}><img src={image} alt={`Preview view ${index + 1}`} className="h-full w-full object-cover" /></button>)}</div>}</> : <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-[#718096]"><span className="material-symbols-outlined text-5xl">image</span><span className="text-xs">Product photos appear here</span></div>}
                    </div>
                    <div className="space-y-4 p-5">
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">{form.brand || form.category_name || "Your store"}</p><h3 className="mt-1 text-xl font-bold text-[#0b1c30]">{form.name || "Product name"}</h3></div>
                      {form.subcategory && <span className="inline-flex w-fit rounded-full bg-[#eff4ff] px-2.5 py-1 text-xs text-[#526276]">{form.subcategory}</span>}
                      <div className="flex items-baseline gap-2"><strong className="text-2xl text-[#0b1c30]">₹{previewPrice.toLocaleString("en-IN")}</strong>{previewDiscountPct > 0 && <><span className="text-sm text-[#718096] line-through">₹{previewMrp.toLocaleString("en-IN")}</span><span className="rounded bg-[#e5f7ee] px-2 py-1 text-xs font-bold text-[#006948]">{previewDiscountPct}% off</span></>}</div>
                      {form.description && <p className="text-sm leading-6 text-[#526276]">{form.description}</p>}
                      {specs.some((item) => item.key.trim() && item.value.trim()) && <div className="space-y-1.5"><strong className="text-sm text-[#0b1c30]">Product details</strong>{specs.filter((item) => item.key.trim() && item.value.trim()).map((item, index) => <div key={index} className="flex justify-between gap-3 text-xs text-[#526276]"><span>{item.key}</span><span className="text-right font-medium text-[#0b1c30]">{item.value}</span></div>)}</div>}
                      <div className="space-y-2"><strong className="text-sm text-[#0b1c30]">Available options</strong>{colorVariantGroups.filter((group) => group.color || group.subvariants.some((option) => option.spec)).map((group, index) => <div key={index} className="rounded-lg border border-[#e2e8f0] p-3 text-sm"><b>{group.colorKey || primaryOptionKey}: {group.color || "—"}</b><div className="mt-2 flex flex-wrap gap-1.5">{group.subvariants.filter((option) => option.spec).map((option, optionIndex) => {
                        const configuration = variantConfigurations[combinationKey(buildColorVariantOptions(group.color, option.spec, group.colorKey, group.specKey))] || {};
                        const salePrice = configuration.price || configuration.original_price;
                        return <span key={optionIndex} className="rounded-lg bg-[#eff4ff] px-2.5 py-1.5 text-xs">{option.spec}{salePrice ? ` · ₹${Number(salePrice).toLocaleString("en-IN")}` : ""}{Number(configuration.original_price) > Number(configuration.price) && <s className="ml-1 text-[#718096]">₹{Number(configuration.original_price).toLocaleString("en-IN")}</s>}</span>;
                      })}</div></div>)}</div>
                      {highlights.some((item) => item.trim()) && <ul className="list-disc space-y-1 pl-5 text-sm text-[#526276]">{highlights.filter((item) => item.trim()).map((item, index) => <li key={index}>{item}</li>)}</ul>}
                      <p className="text-xs text-[#718096]">Preview of the customer product card. Final appearance may vary by storefront layout.</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
            <form id="vendor-product-form" onSubmit={handlePublishProduct} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* TAB 1: GENERAL INFO */}
              {modalTab === "general" && (
                <div className="space-y-4">
                  <div className="product-editor-section-heading mb-1"><div><h3>Basic information</h3><p>Start with the product identity and choose its marketplace category.</p></div></div>
                  <div>
                    <label className="block text-[12px] font-semibold text-[#0b1c30] mb-1.5">Product Title *</label>
                    <input
                      type="text"
                      required
                      placeholder={productNamePlaceholder}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full h-11 px-3.5 rounded-lg bg-[#eff4ff] text-[13.5px] text-[#0b1c30] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#006948]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[12px] font-semibold text-[#0b1c30] mb-1.5">Category *</label>
                      <select
                        value={form.category_name}
                        onChange={(e) => handleCategoryChange(e.target.value)}
                        className="w-full h-11 px-3 rounded-lg bg-[#eff4ff] text-[13px] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]"
                      >
                        {categories.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] leading-4 text-[#64748b]">Choose a category first. Its selectable options and suggested product details will appear in the next steps.</p>
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-[#0b1c30] mb-1.5">Subcategory</label>
                      {subcategoryOptions.length ? <select value={form.subcategory} onChange={(event) => handleSubcategoryChange(event.target.value)} className="w-full h-11 px-3 rounded-lg bg-[#eff4ff] text-[13px] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]"><option value="">Select a subcategory</option>{subcategoryOptions.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}</select> : <input type="text" value={form.subcategory} onChange={(event) => handleSubcategoryChange(event.target.value)} placeholder="Enter subcategory" className="w-full h-11 px-3.5 rounded-lg bg-[#eff4ff] text-[13px] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]" />}
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-[#0b1c30] mb-1.5">Brand Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Your brand name"
                        value={form.brand}
                        onChange={(e) => setForm({ ...form, brand: e.target.value })}
                        className="w-full h-11 px-3.5 rounded-lg bg-[#eff4ff] text-[13px] text-[#0b1c30] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#006948]"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-[#0b1c30] mb-1.5">Merchant SKU</label>
                      <input
                        type="text"
                        placeholder="e.g. SKU-001"
                        value={form.sku}
                        onChange={(e) => setForm({ ...form, sku: e.target.value })}
                        className="w-full h-11 px-3.5 rounded-lg bg-[#eff4ff] text-[13px] font-mono text-[#0b1c30] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#006948]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-[#0b1c30] mb-1.5">Detailed Product Description</label>
                    <textarea
                      rows={4}
                      placeholder="Describe the materials, key features, what’s included, care instructions, or warranty..."
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full p-3.5 rounded-lg bg-[#eff4ff] text-[13px] text-[#0b1c30] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#006948]"
                    />
                  </div>

                </div>
              )}

              {/* INVENTORY AND SHIPPING */}
              {modalTab === "details" && (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl bg-[#eff4ff] space-y-4">
                  <span className="text-[13px] font-bold text-[#0b1c30] block">Inventory tracking</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11.5px] font-semibold text-[#3d4a42] mb-1">Available Stock Qty *</label>
                        <input
                          type="number"
                          min="0"
                          required
                          placeholder="50"
                          value={form.stock}
                          onChange={(e) => setForm({ ...form, stock: e.target.value })}
                          className="w-full h-11 px-3.5 rounded-lg bg-white text-[13.5px] font-semibold text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11.5px] font-semibold text-[#3d4a42] mb-1">Low-Stock Threshold</label>
                        <input
                          type="number"
                          min="1"
                          value={form.low_stock_threshold}
                          onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                          className="w-full h-11 px-3.5 rounded-lg bg-white text-[13.5px] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]"
                        />
                      </div>

                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-[#eff4ff] space-y-4">
                    <span className="text-[13px] font-bold text-[#0b1c30] block">Shipping</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11.5px] font-semibold text-[#3d4a42] mb-1">Weight (kg)</label>
                        <input
                          type="text"
                          placeholder="0.45 kg"
                          value={form.weight}
                          onChange={(e) => setForm({ ...form, weight: e.target.value })}
                          className="w-full h-11 px-3.5 rounded-lg bg-white text-[13.5px] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11.5px] font-semibold text-[#3d4a42] mb-1">Dimensions (L × W × H)</label>
                        <input type="text" placeholder="e.g. 30 × 20 × 10 cm" value={form.dimensions} onChange={(event) => setForm({ ...form, dimensions: event.target.value })} className="w-full h-11 px-3.5 rounded-lg bg-white text-[13.5px] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CATEGORY-BASED VARIANTS AND PRICING */}
              {modalTab === "variants" && (
                <div className="space-y-6">
                  <section className="product-option-section">
                    <div className="product-editor-section-heading">
                      <div><h3>Pricing</h3><p>{isShoeCategory ? "Add a color group and enter each shoe size." : isApparelCategory ? "Add a color group and enter each clothing size." : `Add a ${primaryOptionKey.toLowerCase()} group and enter each ${secondaryOptionKey.toLowerCase()}.`} Set MRP and selling price per row; the discount is calculated automatically.</p></div>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => setColorVariantGroups((current) => [...current, { colorKey: primaryOptionKey, specKey: secondaryOptionKey, color: "", sharedPrice: "", images: [], main_image: "", subvariants: [{ spec: "" }] }])} className="product-editor-add-button"><span className="material-symbols-outlined">add</span>Add {primaryOptionKey.toLowerCase()} group</button>
                      </div>
                    </div>
                    <div className="product-variant-guide"><b>For {form.category_name || "this category"}</b><br />Use {primaryOptionKey.toLowerCase()} for the group and {secondaryOptionKey.toLowerCase()} for each row. Photos are shared by the group; MRP and offer price belong to each row.</div>
                    <div className="space-y-3">
                      {colorVariantGroups.map((group, groupIndex) => {
                        return <div key={`color-group-${groupIndex}`} className="variant-color-group">
                          <div className="variant-color-group-heading">
                            {group.main_image || group.images?.[0] ? <img src={group.main_image || group.images[0]} alt={`${group.colorKey || primaryOptionKey} group photo`} /> : <span className="material-symbols-outlined">category</span>}
                            <div className="variant-color-name-field"><small>{(group.colorKey || primaryOptionKey).toUpperCase()}</small><input value={group.color} placeholder={`Enter ${primaryOptionKey.toLowerCase()}`} onChange={(event) => updateColorGroupName(groupIndex, event.target.value)} /></div>
                            <button type="button" aria-label={`Remove ${group.colorKey || primaryOptionKey} group`} onClick={() => setColorVariantGroups((current) => current.filter((_, index) => index !== groupIndex))}><span className="material-symbols-outlined">delete</span></button>
                          </div>
                          <div className="variant-spec-table">
                            <div className="variant-spec-table-heading"><span>{secondaryOptionKey}</span><span>MRP (₹)</span><span>Selling price (₹)</span><span /></div>
                            {group.subvariants.map((subvariant, subvariantIndex) => {
                              const options = buildColorVariantOptions(group.color, subvariant.spec, group.colorKey, group.specKey);
                              const key = combinationKey(options);
                              const current = variantConfigurations[key] || { price: "", original_price: "" };
                              const mrpValue = current.original_price ?? current.price ?? "";
                              const offerValue = current.original_price != null && Number(current.price) !== Number(current.original_price) ? current.price : "";
                              const rowDiscount = Number(mrpValue) > Number(current.price) && Number(mrpValue) > 0 ? Math.round(((Number(mrpValue) - Number(current.price)) / Number(mrpValue)) * 100) : 0;
                              return <div key={`subvariant-${groupIndex}-${subvariantIndex}`} className="variant-spec-table-row">
                                <input value={subvariant.spec} placeholder={isApparelCategory ? "e.g. S, M, L, XL" : `Enter ${secondaryOptionKey.toLowerCase()}`} onChange={(event) => updateColorSubvariant(groupIndex, subvariantIndex, event.target.value)} />
                                <input aria-label={`${group.color || primaryOptionKey} ${subvariant.spec || secondaryOptionKey} MRP`} type="number" min="1" step="0.01" placeholder="Required" value={mrpValue} onChange={(event) => {
                                  const mrp = event.target.value;
                                  setVariantConfigurations((prev) => ({ ...prev, [key]: { ...current, options, original_price: mrp, price: (!current.price || Number(current.price) >= Number(current.original_price ?? current.price)) ? mrp : current.price } }));
                                  if (groupIndex === 0 && subvariantIndex === 0) setForm((previous) => ({ ...previous, price: mrp }));
                                }} />
                                <div className="variant-offer-cell"><input aria-label={`${group.color || primaryOptionKey} ${subvariant.spec || secondaryOptionKey} selling price`} type="number" min="1" step="0.01" placeholder="Leave blank for MRP" value={offerValue} onChange={(event) => {
                                  const offer = event.target.value;
                                  setVariantConfigurations((prev) => ({ ...prev, [key]: { ...current, options, price: offer || current.original_price || current.price } }));
                                  if (groupIndex === 0 && subvariantIndex === 0) setForm((previous) => ({ ...previous, discount_price: offer }));
                                }} />{rowDiscount > 0 && <small>Auto discount · Save {rowDiscount}%</small>}</div>
                              <button type="button" aria-label={`Remove ${secondaryOptionKey} option`} onClick={() => setColorVariantGroups((all) => all.map((item, index) => index === groupIndex ? { ...item, subvariants: item.subvariants.filter((_, optionIndex) => optionIndex !== subvariantIndex) } : item))}><span className="material-symbols-outlined">close</span></button>
                              </div>;
                            })}
                            <div className="flex flex-wrap gap-2 mt-2">
                              <button type="button" className="product-editor-add-button" onClick={() => setColorVariantGroups((current) => current.map((item, index) => index === groupIndex ? { ...item, subvariants: item.subvariants.some((option) => !option.spec.trim()) ? item.subvariants : [...item.subvariants, { spec: "" }] } : item))}><span className="material-symbols-outlined">add</span>Add {secondaryOptionKey} option</button>
                              {isApparelCategory && <button type="button" className="product-editor-add-button" onClick={() => addCommonApparelSizes(groupIndex)}><span className="material-symbols-outlined">checkroom</span>Add common sizes</button>}
                            </div>
                          </div>
                          
                          <div className="variant-color-gallery">
                            <div><strong>{group.colorKey || primaryOptionKey} photos</strong><small>One main photo and additional angles for this group</small></div>
                            <div className="variant-combination-upload-row"><label className="variant-combination-upload">{uploadingImg ? "Uploading…" : "Upload photos"}<input type="file" accept="image/*" multiple disabled={uploadingImg} onChange={(event) => handleColorPhotoUpload(event, groupIndex)} /></label><div className="variant-combination-url"><input type="url" placeholder="Paste photo URL" value={colorImageUrlInputs[groupIndex] || ""} onChange={(event) => setColorImageUrlInputs((prev) => ({ ...prev, [groupIndex]: event.target.value }))} /><button type="button" onClick={() => handleAddColorPhotoUrl(groupIndex)}>Add URL</button></div></div>
                            {group.images?.length ? <div className="variant-combination-photos">{group.images.map((image, imageIndex) => <div key={`${image}-${imageIndex}`}><img src={image} alt={`${group.color || primaryOptionKey} angle ${imageIndex + 1}`} /><button type="button" aria-label="Remove group photo" onClick={() => removeColorPhoto(groupIndex, image)}>×</button><label><input type="radio" name={`color-main-${groupIndex}`} checked={group.main_image === image || (!group.main_image && group.images[0] === image)} onChange={() => setColorVariantGroups((current) => current.map((item, index) => index === groupIndex ? { ...item, main_image: image } : item))} /> Main photo</label><small>Other angle</small></div>)}</div> : <small>Add photos once for this {primaryOptionKey.toLowerCase()} group; all its {secondaryOptionKey.toLowerCase()} options will use them.</small>}
                          </div>
                        </div>;
                    })}
                    </div>
                  </section>

                </div>
              )}

              {modalTab === "details" && (
                <div className="space-y-6">
                  <section className="product-option-section product-spec-section">
                    <div className="product-editor-section-heading">
                      <div><h3>Specifications · {form.category_name}</h3><p>These suggested fields are based on the selected category. Add values shoppers need, such as material, warranty, dimensions, or battery life.</p></div>
                      <button type="button" onClick={() => setSpecs([...specs, { key: "", value: "" }])} className="product-editor-add-button"><span className="material-symbols-outlined">add</span>Add detail</button>
                    </div>
                    {specs.length === 0 ? <div className="product-editor-empty">No product details added yet. Add information specific to this category.</div> : <div className="product-editor-rows">
                      <div className="product-editor-row-labels"><span>Detail</span><span>Value</span><span /></div>
                      {specs.map((row, idx) => <div key={`spec-${idx}`} className="product-editor-row">
                        <input type="text" aria-label={`Specification name ${idx + 1}`} placeholder="e.g. Battery life" value={row.key} onChange={(event) => setSpecs(specs.map((item, i) => i === idx ? { ...item, key: event.target.value } : item))} />
                        <input type="text" aria-label={`Specification details ${idx + 1}`} placeholder="e.g. Up to 30 hours" value={row.value} onChange={(event) => setSpecs(specs.map((item, i) => i === idx ? { ...item, value: event.target.value } : item))} />
                        <button type="button" aria-label={`Remove specification ${idx + 1}`} onClick={() => setSpecs(specs.filter((_, i) => i !== idx))}><span className="material-symbols-outlined">delete</span></button>
                      </div>)}
                    </div>}
                  </section>

                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[13px] font-bold text-[#0b1c30]">Key Selling Highlights (Bullet Points)</span>
                      <button
                        type="button"
                        onClick={() => setHighlights([...highlights, ""])}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#eff4ff] text-[#006948] text-[12px] font-semibold hover:bg-[#dce9ff]"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span> Add Feature
                      </button>
                    </div>

                    <div className="space-y-2">
                      {highlights.map((hl, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#006948] shrink-0"></span>
                          <input
                            type="text"
                            placeholder={`Feature bullet #${idx + 1}`}
                            value={hl}
                            onChange={(e) =>
                              setHighlights(highlights.map((item, i) => (i === idx ? e.target.value : item)))
                            }
                            className="flex-1 h-10 px-3 rounded-lg bg-[#eff4ff] text-[12.5px] text-[#0b1c30] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#006948]"
                          />
                          {highlights.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setHighlights(highlights.filter((_, i) => i !== idx))}
                              className="p-1.5 text-[#6d7a72] hover:text-[#ba1a1a]"
                            >
                              <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </form>
            )}

            {/* Modal Sticky Footer */}
            <div className="px-6 py-4 border-t border-[#eff4ff] bg-white flex items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {modalTab !== "general" && (
                  <button
                    type="button"
                    onClick={() => setModalTab(modalTab === "details" ? "variants" : "general")}
                    className="px-4 py-2.5 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] font-semibold hover:bg-[#dce9ff]"
                  >
                    Back
                  </button>
                )}
                {modalTab !== "details" && (
                  <button
                    type="button"
                    onClick={() => setModalTab(modalTab === "general" ? "variants" : "details")}
                    className="px-4 py-2.5 rounded-lg bg-[#dce9ff] text-[#006948] text-[13px] font-semibold hover:bg-[#cbdbf5]"
                  >
                    Next Step →
                  </button>
                )}
                {!editingProductId && <button type="button" onClick={handleSaveProgress} className="px-3 py-2.5 rounded-lg border border-[#d7e3f4] text-[12px] font-semibold text-[#006948] hover:bg-[#eff4ff]"><span className="material-symbols-outlined mr-1 align-middle text-[16px]">save</span>Save progress</button>}
                {!showPreview && <button type="button" onClick={handleResetProductForm} disabled={submitting || uploadingImg} className="px-3 py-2.5 rounded-lg border border-[#e4caca] text-[12px] font-semibold text-[#8a3434] hover:bg-[#fff3f2] disabled:cursor-not-allowed disabled:opacity-50"><span className="material-symbols-outlined mr-1 align-middle text-[16px]">restart_alt</span>{editingProductId ? "Reset changes" : "Reset form"}</button>}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-lg text-[13px] font-semibold text-[#3d4a42] hover:bg-[#eff4ff]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="vendor-product-form"
                  disabled={submitting || showPreview}
                  className="px-5 py-2.5 rounded-lg bg-[#006948] hover:bg-[#00855d] text-white text-[13px] font-semibold shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">{submitting ? "progress_activity" : "publish"}</span>
                  <span>{submitting ? (editingProductId ? "Saving..." : "Submitting...") : (editingProductId ? "Save Changes" : "Submit for Admin Approval")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
