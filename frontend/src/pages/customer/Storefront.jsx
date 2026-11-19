import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import NotificationBell from "../../components/NotificationBell";

const API_BASE = "http://127.0.0.1:8000";
const SELECTABLE_OPTION_KEY = /(color|colour|ram|memory|storage|capacity|size|variant|style|fit|pattern|finish|edition|waist|shoe)/i;
const COLOR_SWATCHES = { black: "#202124", white: "#ffffff", blue: "#3867d6", navy: "#172c52", red: "#d94f55", green: "#47856b", teal: "#218b83", silver: "#c7ccd2", gold: "#d5b66e", purple: "#8064a8", pink: "#e3a6b6", graphite: "#555a60", brown: "#795548", beige: "#d6c3a4", orange: "#ed8b36" };

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-razorpay-checkout="true"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.dataset.razorpayCheckout = "true";
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

function getSwatchColor(choice) {
  const normalized = choice.toLowerCase().trim();
  if (COLOR_SWATCHES[normalized]) return COLOR_SWATCHES[normalized];
  return typeof CSS !== "undefined" && CSS.supports("color", choice) ? choice : "#dfe5ec";
}

function getProductOptions(product) {
  const options = new Map();
  const addChoice = (key, value) => {
    if (!SELECTABLE_OPTION_KEY.test(key) || value == null || value === "") return;
    const list = Array.isArray(value) ? value : String(value).split(/[,|]/);
    const existing = options.get(key) || [];
    options.set(key, [...new Set([...existing, ...list.map((choice) => String(choice).trim()).filter(Boolean)])]);
  };
  Object.entries(product?.specifications || {}).forEach(([key, value]) => addChoice(key, value));
  (product?.variant_configurations || []).forEach((configuration) => {
    Object.entries(configuration.options || {}).forEach(([key, value]) => addChoice(key, value));
  });
  return [...options].flatMap(([key, choices]) => {
    const singleConfiguration = /colou?r|ram|memory|storage|capacity/i.test(key) && choices.length === 1;
    return choices.length > 1 || singleConfiguration ? [{ key, choices }] : [];
  }).sort((a, b) => {
    const rank = (key) => /colou?r/i.test(key) ? 0 : /ram|memory/i.test(key) ? 1 : /storage|capacity/i.test(key) ? 2 : 3;
    return rank(a.key) - rank(b.key);
  });
}

function isColorOption(product, optionKey) {
  if (/colou?r/i.test(optionKey)) return true;
  if (!/(variant|option|group)/i.test(optionKey)) return false;
  const choices = getProductOptions(product).find((option) => option.key === optionKey)?.choices || [];
  return choices.length > 0 && choices.every((choice) =>
    Object.prototype.hasOwnProperty.call(COLOR_SWATCHES, choice.toLowerCase().trim()) ||
    (typeof CSS !== "undefined" && CSS.supports("color", choice))
  );
}

function getSelectedConfiguration(product, selectedOptions) {
  return (product?.variant_configurations || []).find((configuration) => {
    const options = configuration.options || {};
    const selected = selectedOptions || {};
    const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const optionEntries = Object.entries(options);
    return optionEntries.length === Object.keys(selected).length && optionEntries.every(([key, value]) => normalize(selected[key]) === normalize(value));
  }) || null;
}

function getAvailableOptionChoices(product, optionKey, selectedOptions) {
  const fallback = getProductOptions(product).find((option) => option.key === optionKey)?.choices || [];
  const configurations = product?.variant_configurations || [];
  if (!configurations.length) return fallback;
  const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  // Keep all saved colors visible even when the currently selected size has no
  // matching configuration row. A color can still have other available sizes.
  if (isColorOption(product, optionKey)) {
    const choices = configurations.map((configuration) => configuration.options?.[optionKey]).filter(Boolean);
    return [...new Set([...fallback, ...choices])];
  }
  const compatible = configurations.filter((configuration) => Object.entries(selectedOptions || {}).every(([key, value]) => key === optionKey || !value || normalize(configuration.options?.[key]) === normalize(value)));
  const choices = [...new Set(compatible.map((configuration) => configuration.options?.[optionKey]).filter(Boolean))];
  return choices.length ? choices : fallback;
}

function getColorImages(product, optionKey, color) {
  const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const configurations = product?.variant_configurations || [];
  const choices = getProductOptions(product).find((option) => option.key === optionKey)?.choices || [];
  const gallery = product?.gallery_images?.length ? product.gallery_images : product?.image_url ? [product.image_url] : [];
  const selectedConfigurations = configurations.filter((item) => normalize(item.options?.[optionKey]) === normalize(color));
  const selectedImages = [...new Set(selectedConfigurations.flatMap((item) => [item.main_image, ...(item.images || [])]).filter(Boolean))];
  const otherColorImages = choices.filter((choice) => normalize(choice) !== normalize(color)).map((choice) => {
    const group = configurations.filter((item) => normalize(item.options?.[optionKey]) === normalize(choice));
    return [...new Set(group.flatMap((item) => [item.main_image, ...(item.images || [])]).filter(Boolean))];
  }).filter((images) => images.length);
  const hasColorSpecificImages = selectedImages.length && otherColorImages.some((images) => JSON.stringify(images) !== JSON.stringify(selectedImages));
  if (hasColorSpecificImages) {
    const mainImage = selectedConfigurations.find((item) => item.main_image)?.main_image;
    return mainImage ? [mainImage, ...selectedImages.filter((image) => image !== mainImage)] : selectedImages;
  }

  // Legacy listings sometimes attached the same product gallery to every
  // color. When there is exactly one gallery image per color, pair them by order.
  const colorIndex = choices.findIndex((choice) => normalize(choice) === normalize(color));
  if (gallery.length === choices.length && colorIndex >= 0) return [gallery[colorIndex]];
  return [];
}

function getOptionChoiceImage(product, selectedOptions, optionKey, choice) {
  const legacyImage = product?.variant_images?.[optionKey]?.[choice];
  return getColorImages(product, optionKey, choice)[0] || (Array.isArray(legacyImage) ? legacyImage[0] : legacyImage) || null;
}

function getSelectedVariantImages(product, selectedOptions) {
  const selectedColor = Object.entries(selectedOptions || {}).find(([key]) => isColorOption(product, key));
  if (selectedColor) {
    const colorImages = getColorImages(product, selectedColor[0], selectedColor[1]);
    if (colorImages.length) return colorImages;
    const legacyImage = product?.variant_images?.[selectedColor[0]]?.[selectedColor[1]];
    return Array.isArray(legacyImage) ? legacyImage : legacyImage ? [legacyImage] : [];
  }
  const configuration = getSelectedConfiguration(product, selectedOptions);
  if (configuration) {
    const images = configuration.images || [];
    if (images.length) return configuration.main_image ? [configuration.main_image, ...images.filter((image) => image !== configuration.main_image)] : images;
  }
  for (const [key, choice] of Object.entries(selectedOptions || {})) {
    const assigned = product?.variant_images?.[key]?.[choice];
    const images = Array.isArray(assigned) ? assigned : assigned ? [assigned] : [];
    if (images.length) return images;
  }
  return [];
}

export default function Storefront() {
  const navigate = useNavigate();
  const token = localStorage.getItem("nexcart_customer_token");
  const customerId = localStorage.getItem("nexcart_customer_id");
  const [customerName, setCustomerName] = useState(localStorage.getItem("nexcart_customer_name") || "Customer");
  const [customerEmail, setCustomerEmail] = useState(localStorage.getItem("nexcart_customer_email") || localStorage.getItem("nexcart_customer_user_email") || "");

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [cart, setCart] = useState([]);

  // Navigation & Filters
  const [activeView, setActiveView] = useState("discover"); // "discover" | "orders" | "wishlist"
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("featured");

  // Modals & Drawers
  const [quickViewProduct, setQuickViewProduct] = useState(null);
  const [productReviewData, setProductReviewData] = useState({ average_rating: 0, review_count: 0, can_review: false, my_review: null, reviews: [] });
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [editingCartItem, setEditingCartItem] = useState(null);
  const [selectedVariantOptions, setSelectedVariantOptions] = useState({});
  const [catalogVariantSelections, setCatalogVariantSelections] = useState({});
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const productDetailsRef = useRef(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState("cart"); // "cart" | "address" | "review" | "payment" | "success"

  // Live Checkout State (No Dummy Values)
  const [shippingAddress, setShippingAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("RAZORPAY");
  const [couponDraft, setCouponDraft] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);
  const [lastCreatedOrder, setLastCreatedOrder] = useState(null);
  const [toast, setToast] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ full_name: customerName, phone: localStorage.getItem("nexcart_customer_phone") || "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [addressEditingOrderId, setAddressEditingOrderId] = useState(null);
  const [addressDraft, setAddressDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState(null);
  const [savingOrderAction, setSavingOrderAction] = useState(false);
  const [orderFilter, setOrderFilter] = useState("active");

  useEffect(() => {
    if (quickViewProduct && productDetailsRef.current) {
      productDetailsRef.current.scrollTop = 0;
    }
    const selectableOptions = getProductOptions(quickViewProduct);
    const defaults = Object.fromEntries(selectableOptions.map(({ key, choices }) => [key, choices[0]]));
    const remembered = catalogVariantSelections[quickViewProduct?.id] || {};
    const validRemembered = Object.fromEntries(selectableOptions
      .filter(({ key, choices }) => choices.includes(remembered[key]))
      .map(({ key }) => [key, remembered[key]]));
    setSelectedVariantOptions({ ...defaults, ...validRemembered });
  }, [quickViewProduct, catalogVariantSelections]);

  useEffect(() => {
    if (!quickViewProduct?.id) return;
    let active = true;
    setReviewLoading(true);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    axios.get(`${API_BASE}/store/products/${quickViewProduct.id}/reviews`, { headers })
      .then(({ data }) => {
        if (!active) return;
        const nextData = data || { average_rating: 0, review_count: 0, can_review: false, my_review: null, reviews: [] };
        setProductReviewData(nextData);
        setReviewRating(nextData.my_review?.rating || 5);
        setReviewComment(nextData.my_review?.comment || "");
      })
      .catch(() => {
        if (active) setProductReviewData({ average_rating: 0, review_count: 0, can_review: false, my_review: null, reviews: [] });
      })
      .finally(() => { if (active) setReviewLoading(false); });
    return () => { active = false; };
  }, [quickViewProduct?.id, token]);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  };

  const submitProductReview = async () => {
    if (!token) return notify("Sign in as a customer to review this product.");
    setReviewSaving(true);
    try {
      await axios.post(`${API_BASE}/store/products/${quickViewProduct.id}/reviews`, {
        rating: reviewRating,
        comment: reviewComment,
      }, { headers: { Authorization: `Bearer ${token}` } });
      const response = await axios.get(`${API_BASE}/store/products/${quickViewProduct.id}/reviews`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProductReviewData(response.data);
      notify("Your product review was saved.");
    } catch (error) {
      notify(error.response?.data?.detail || "Could not save your product review.");
    } finally {
      setReviewSaving(false);
    }
  };

  const toggleAccountMenu = async () => {
    if (accountOpen) {
      setAccountOpen(false);
      setProfileEditing(false);
      return;
    }
    setAccountOpen(true);
    setProfileEditing(false);
    try {
      const response = await axios.get(`${API_BASE}/store/profile`, { headers: { Authorization: `Bearer ${token}` } });
      setCustomerName(response.data.full_name || "Customer");
      setCustomerEmail(response.data.email || "");
      setProfileDraft({ full_name: response.data.full_name || "", phone: response.data.phone || "" });
    } catch (error) {
      notify(error.response?.data?.detail || "Could not load your account details.");
    }
  };

  const saveCustomerProfile = async () => {
    if (profileDraft.full_name.trim().length < 2) return notify("Enter a name with at least 2 characters.");
    setSavingProfile(true);
    try {
      const response = await axios.put(`${API_BASE}/store/profile`, {
        full_name: profileDraft.full_name.trim(), phone: profileDraft.phone.trim(),
      }, { headers: { Authorization: `Bearer ${token}` } });
      setCustomerName(response.data.full_name);
      setCustomerEmail(response.data.email || customerEmail);
      localStorage.setItem("nexcart_customer_name", response.data.full_name);
      localStorage.setItem("nexcart_customer_email", response.data.email || customerEmail);
      localStorage.setItem("nexcart_customer_phone", response.data.phone || "");
      setProfileDraft({ full_name: response.data.full_name, phone: response.data.phone || "" });
      setProfileEditing(false);
      notify("Your account details were saved.");
    } catch (error) {
      notify(error.response?.data?.detail || "Could not save your account details.");
    } finally {
      setSavingProfile(false);
    }
  };

  const applyCoupon = () => {
    const code = couponDraft.trim().toUpperCase();
    if (!code) return notify("Enter a coupon code first.");
    const applies = cart.some((item) => {
      const terms = products.find((product) => product.id === item.id)?.admin_terms || {};
      return terms.coupon_code?.trim().toUpperCase() === code && Number(terms.coupon_percent) > 0;
    });
    if (!applies) {
      setCouponCode("");
      return notify("That coupon is not valid for products in your bag.");
    }
    setCouponCode(code);
    notify(`Coupon ${code} applied.`);
  };

  const chooseVariantOption = (optionKey, choice) => {
    const next = { ...selectedVariantOptions, [optionKey]: choice };
    const options = getProductOptions(quickViewProduct);
    const changedIndex = options.findIndex(({ key }) => key === optionKey);
    options.forEach(({ key }, index) => {
      if (key === optionKey) return;
      const filterOptions = { ...next };
      options.slice(index + 1).forEach(({ key: laterKey }) => { delete filterOptions[laterKey]; });
      if (index < changedIndex) delete filterOptions[optionKey];
      const available = getAvailableOptionChoices(quickViewProduct, key, filterOptions);
      if (!available.includes(next[key])) next[key] = available[0] || "";
    });
    setSelectedVariantOptions(next);
    setCatalogVariantSelections((current) => ({ ...current, [quickViewProduct.id]: next }));
    setActiveImageIdx(0);
  };

  // Load live storefront data
  const fetchStoreData = async () => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      const prodRes = await axios.get(`${API_BASE}/store/products`);
      setProducts(Array.isArray(prodRes.data) ? prodRes.data : []);
    } catch (err) {
      console.error("Failed loading products:", err);
      setProducts([]);
    }

    if (token && customerId) {
      try {
        const [ordRes, cartRes, wishlistRes, addressRes] = await Promise.all([
          axios.get(`${API_BASE}/store/orders/${customerId}`, { headers }),
          axios.get(`${API_BASE}/cart/${customerId}`, { headers }),
          axios.get(`${API_BASE}/store/wishlist/${customerId}`, { headers }),
          axios.get(`${API_BASE}/store/addresses/${customerId}`, { headers }),
        ]);
        const orderData = Array.isArray(ordRes.data) ? ordRes.data : [];
        setOrders(orderData);
        setCart((Array.isArray(cartRes.data) ? cartRes.data : []).map((item) => ({
          id: item.product_id,
          cart_item_id: item.cart_item_id,
          name: item.name,
          brand: item.brand || "",
          price: item.discount_price && item.discount_price < item.price ? item.discount_price : item.price,
          mrp: item.price,
          image_url: item.image_url,
          stock: item.stock,
          qty: item.quantity,
          variant_options: item.variant_options || {},
        })));
        setWishlist((Array.isArray(wishlistRes.data) ? wishlistRes.data : []).map((item) => item.id));

        const fromAddresses = (Array.isArray(addressRes.data) ? addressRes.data : []).map((a) =>
          `${a.street}, ${a.city}, ${a.state} - ${a.pincode}`
        );
        const fromOrders = orderData.map((order) => order.shipping_address).filter(Boolean);
        setSavedAddresses(Array.from(new Set([...fromAddresses, ...fromOrders])));
      } catch (err) {
        console.error("Failed loading customer account data:", err);
      }
    } else {
      setOrders([]);
      setCart([]);
      setWishlist([]);
      setSavedAddresses([]);
    }
  };

  useEffect(() => {
    fetchStoreData();
    const interval = setInterval(fetchStoreData, 8000);
    return () => clearInterval(interval);
  }, [token]);

  // Cart Operations
  const addToCart = async (product, variantOptions = {}) => {
    if (!token || !customerId) {
      notify("Please sign in as a customer to add items to your bag.");
      navigate("/login");
      return false;
    }
    if (product.stock <= 0) {
      notify("This item is currently out of stock.");
      return false;
    }
    const optionSignature = (options) => JSON.stringify(Object.fromEntries(Object.entries(options || {}).sort(([a], [b]) => a.localeCompare(b))));
    const existing = cart.find((item) => item.id === product.id && optionSignature(item.variant_options) === optionSignature(variantOptions));
    const nextQty = (existing?.qty || 0) + 1;
    if (nextQty > product.stock) {
      notify(`Maximum available stock (${product.stock}) reached.`);
      return false;
    }
    try {
      await axios.put(`${API_BASE}/cart/${customerId}/items/${product.id}`, { quantity: nextQty, variant_options: variantOptions }, { headers: { Authorization: `Bearer ${token}` } });
      await fetchStoreData();
      setCheckoutStep("cart");
      setCartOpen(true);
      const selectedSummary = Object.values(variantOptions).join(" · ");
      notify(`Added "${product.name}"${selectedSummary ? ` (${selectedSummary})` : ""} to bag`);
      return true;
    } catch (err) { notify(err.response?.data?.detail || "Could not update your bag."); return false; }
  };

  const updateCartVariant = async (product, nextOptions) => {
    if (!editingCartItem || !token || !customerId) return false;
    const signature = (options) => JSON.stringify(Object.fromEntries(Object.entries(options || {}).sort(([left], [right]) => left.localeCompare(right))));
    if (signature(editingCartItem.variant_options) === signature(nextOptions)) {
      setEditingCartItem(null);
      setQuickViewProduct(null);
      setCartOpen(true);
      return true;
    }
    const matchingItem = cart.find((item) => item.cart_item_id !== editingCartItem.cart_item_id && item.id === product.id && signature(item.variant_options) === signature(nextOptions));
    const nextQuantity = (matchingItem?.qty || 0) + editingCartItem.qty;
    if (nextQuantity > product.stock) {
      notify(`Only ${product.stock} units are available for this option.`);
      return false;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.put(`${API_BASE}/cart/${customerId}/items/${product.id}`, { quantity: nextQuantity, variant_options: nextOptions }, { headers });
      await axios.put(`${API_BASE}/cart/${customerId}/items/${product.id}`, { quantity: 0, variant_options: editingCartItem.variant_options || {} }, { headers });
      await fetchStoreData();
      setEditingCartItem(null);
      setQuickViewProduct(null);
      setCartOpen(true);
      setCheckoutStep("cart");
      notify("Product options updated in your bag.");
      return true;
    } catch (error) {
      notify(error.response?.data?.detail || "Could not update the product options.");
      return false;
    }
  };

  const updateCartQty = async (cartItemId, delta) => {
    const item = cart.find((entry) => entry.cart_item_id === cartItemId);
    if (!item || !customerId) return;
    const quantity = item.qty + delta;
    if (quantity > item.stock) return notify(`Only ${item.stock} units in stock`);
    try {
      await axios.put(`${API_BASE}/cart/${customerId}/items/${item.id}`, { quantity, variant_options: item.variant_options || {} }, { headers: { Authorization: `Bearer ${token}` } });
      await fetchStoreData();
    } catch (err) { notify(err.response?.data?.detail || "Could not update your bag."); }
  };

  const toggleWishlist = async (productId) => {
    if (!token || !customerId) {
      notify("Please sign in as a customer to save items.");
      navigate("/login");
      return;
    }
    try {
      const response = await axios.post(`${API_BASE}/store/wishlist/${customerId}/${productId}`);
      await fetchStoreData();
      notify(response.data.message);
    } catch (err) { notify(err.response?.data?.detail || "Could not update your saved items."); }
  };

  const startAddressEdit = (order) => {
    setAddressEditingOrderId(order.id);
    setAddressDraft(order.shipping_address || "");
    setLocationDraft(order.delivery_lat != null && order.delivery_lng != null ? { lat: order.delivery_lat, lng: order.delivery_lng } : null);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return notify("Location is not available in this browser.");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setLocationDraft({ lat: coords.latitude, lng: coords.longitude }); notify("Current delivery location added."); },
      () => notify("Could not get your location. Check browser location permission."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const saveOrderAddress = async (order) => {
    if (!addressDraft.trim()) return notify("Enter a delivery address before saving.");
    setSavingOrderAction(true);
    try {
      await axios.patch(`${API_BASE}/store/orders/${order.id}/address`, {
        shipping_address: addressDraft.trim(), lat: locationDraft?.lat ?? null, lng: locationDraft?.lng ?? null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setAddressEditingOrderId(null);
      await fetchStoreData();
      notify("Delivery address and location updated.");
    } catch (error) {
      notify(error.response?.data?.detail || "Could not update this delivery address.");
    } finally { setSavingOrderAction(false); }
  };

  const cancelOrder = async (order) => {
    if (!window.confirm(`Cancel ${order.order_number}? This returns the items to stock.`)) return;
    setSavingOrderAction(true);
    try {
      await axios.post(`${API_BASE}/store/orders/${order.id}/cancel`, {}, { headers: { Authorization: `Bearer ${token}` } });
      await fetchStoreData();
      notify("Order cancelled. Stock has been returned.");
    } catch (error) {
      console.error("Order cancellation failed:", error);
      notify(error.response?.data?.detail || error.message || "Could not cancel this order.");
    } finally { setSavingOrderAction(false); }
  };

  const reorder = async (order) => {
    if (!token || !customerId) return navigate("/login");
    setSavingOrderAction(true);
    try {
      for (const item of order.items || []) {
        if (item.product_id) await axios.put(`${API_BASE}/cart/${customerId}/items/${item.product_id}`, { quantity: item.quantity, variant_options: item.variant_options || {} }, { headers: { Authorization: `Bearer ${token}` } });
      }
      await fetchStoreData();
      setCheckoutStep("cart");
      setCartOpen(true);
      notify("Items added to your bag.");
    } catch (error) {
      notify(error.response?.data?.detail || "Some items could not be reordered. Check current stock.");
    } finally { setSavingOrderAction(false); }
  };

  // Storefront checkout
  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    if (!token) {
      notify("Please sign in as a customer to place an order.");
      navigate("/login");
      return;
    }
    if (shippingAddress.trim().length < 10) {
      notify("Enter a complete delivery address before continuing.");
      return;
    }
    if (!customerId) { notify("Your customer session needs refreshing. Please sign in again."); navigate("/login"); return; }

    setPlacingOrder(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const items = cart.map((item) => ({ product_id: item.id, quantity: item.qty, variant_options: item.variant_options || {} }));
      if (paymentMethod === "COD") {
        const res = await axios.post(`${API_BASE}/store/checkout`, {
          customer_id: Number(customerId), shipping_address: shippingAddress.trim(), address_id: null,
          payment_method: "COD", coupon_code: couponCode, items,
        }, { headers });
        if (!res.data?.order_number) throw new Error("Invalid order confirmation response from server.");
        setLastCreatedOrder({ order_number: res.data.order_number, delivery_otp: res.data.delivery_otp, total: res.data.total_amount ?? grandTotal, method: "COD" });
        setCart([]);
        setCheckoutStep("success");
        fetchStoreData();
        return;
      }

      const orderRes = await axios.post(`${API_BASE}/store/razorpay/order`, { shipping_address: shippingAddress.trim(), coupon_code: couponCode, items }, { headers });
      await loadRazorpayCheckout();
      const checkout = new window.Razorpay({
        key: orderRes.data.key_id,
        amount: orderRes.data.amount,
        currency: orderRes.data.currency,
        name: orderRes.data.name,
        description: orderRes.data.description,
        order_id: orderRes.data.razorpay_order_id,
        prefill: orderRes.data.prefill,
        theme: { color: "#006948" },
        handler: async (paymentResponse) => {
          try {
            const verified = await axios.post(`${API_BASE}/store/razorpay/verify`, {
              checkout_id: orderRes.data.checkout_id,
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature,
            }, { headers });
            if (!verified.data?.order_number) throw new Error("Payment was received but the order could not be confirmed.");
            setLastCreatedOrder({ order_number: verified.data.order_number, delivery_otp: verified.data.delivery_otp, total: verified.data.total_amount ?? grandTotal, method: verified.data.payment_method || "RAZORPAY" });
            setCart([]);
            setCheckoutStep("success");
            fetchStoreData();
          } catch (error) {
            notify(error.response?.data?.detail || error.message || "Payment verification failed. Contact support before retrying.");
          }
        },
        modal: { ondismiss: () => notify("Payment was not completed. Your order has not been placed.") },
      });
      checkout.on("payment.failed", (event) => notify(event.error?.description || "Razorpay could not complete the payment."));
      checkout.open();
    } catch (err) {
      notify(err.response?.data?.detail || err.message || "Checkout failed.");
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("nexcart_customer_token");
    localStorage.removeItem("nexcart_customer_name");
    localStorage.removeItem("nexcart_customer_id");
    localStorage.removeItem("nexcart_customer_email");
    navigate("/login");
  };

  // Derived Categories & Filtered Catalog
  const categoryList = [
    "All",
    ...Array.from(new Set(products.map((p) => p.category || p.category_name).filter(Boolean))),
  ];
  const featuredProduct = products.find((product) => product.stock > 0) || products[0] || null;

  const filteredProducts = products
    .filter((p) => {
      const cat = p.category || p.category_name || "";
      const matchCat = selectedCategory === "All" || cat === selectedCategory;
      const matchSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.brand || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchWishlist = activeView !== "wishlist" || wishlist.includes(p.id);
      return matchCat && matchSearch && matchWishlist;
    })
    .sort((a, b) => {
      const priceA = a.discount_price || a.price;
      const priceB = b.discount_price || b.price;
      if (sortBy === "price-asc") return priceA - priceB;
      if (sortBy === "price-desc") return priceB - priceA;
      return 0;
    });

  const activeOrderCount = orders.filter((order) => order.status !== "Cancelled").length;
  const cancelledOrderCount = orders.length - activeOrderCount;
  const visibleOrders = orders.filter((order) => orderFilter === "cancelled" ? order.status === "Cancelled" : order.status !== "Cancelled");

  // Cart Totals
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totalSavings = cart.reduce((s, i) => s + Math.max(0, (i.mrp - i.price) * i.qty), 0);
  // Keep the visible amount aligned with the current checkout API total.
  const deliveryFee = 0;
  const grandTotal = subtotal + deliveryFee;
  const couponDiscount = couponCode ? cart.reduce((sum, item) => {
    const terms = products.find((product) => product.id === item.id)?.admin_terms || {};
    if (terms.coupon_code?.trim().toUpperCase() !== couponCode) return sum;
    const percent = Math.max(0, Math.min(99, Number(terms.coupon_percent) || 0));
    const discountedUnit = Math.round(item.price * (1 - percent / 100) * 100) / 100;
    return sum + Math.max(0, item.price - discountedUnit) * item.qty;
  }, 0) : 0;
  const payableTotal = Math.max(0, grandTotal - couponDiscount);

  const ORDER_STEPS = ["Processing", "Ready for Pickup", "Shipped", "Out for Delivery", "Delivered"];

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] font-['Inter',sans-serif] pb-20">
      {/* Material You Pill Snackbar Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] bg-[#213145] text-[#eaf1ff] px-5 py-3 rounded-full shadow-xl flex items-center gap-2.5 text-[13px] font-medium">
          <span className="material-symbols-outlined text-[#68dba9] text-[18px]">check_circle</span>
          <span>{toast}</span>
        </div>
      )}

      {/* Top App Bar */}
      <header className="sticky top-0 z-40 bg-[#f8f9ff]/90 backdrop-blur-xl border-b border-[#e5eeff]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div
            onClick={() => setActiveView("discover")}
            className="flex items-center gap-2.5 cursor-pointer shrink-0"
          >
            <div className="w-10 h-10 rounded-2xl bg-[#006948] flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-white text-[22px]">shopping_bag</span>
            </div>
            <div>
              <span className="text-[18px] font-bold tracking-tight text-[#0b1c30] block leading-none">
                NexCart
              </span>
              <span className="text-[11px] font-semibold text-[#006948] tracking-wide">
                STOREFRONT
              </span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex-1 max-w-xl hidden md:block">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#3d4a42] text-[20px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search approved products, brands, or categories..."
                className="w-full h-11 pl-12 pr-4 rounded-full bg-[#eff4ff] text-[13.5px] text-[#0b1c30] placeholder:text-[#5c647a] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#006948] transition-all"
              />
            </div>
          </div>

          {/* Navigation Pills & Bag */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center bg-[#eff4ff] p-1 rounded-full">
              {[
                { id: "discover", icon: "explore", label: "Explore" },
                { id: "wishlist", icon: "favorite", label: `Saved (${wishlist.length})` },
                { id: "orders", icon: "local_shipping", label: `Orders (${activeOrderCount})` },
              ].map((nav) => (
                <button
                  key={nav.id}
                  onClick={() => setActiveView(nav.id)}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-all ${
                    activeView === nav.id
                      ? "bg-[#006948] text-white shadow-sm"
                      : "text-[#3d4a42] hover:text-[#0b1c30]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{nav.icon}</span>
                  <span>{nav.label}</span>
                </button>
              ))}
            </div>

            <NotificationBell role="customer" userId={customerId} />
            <div className="relative">
              <button
                type="button"
                onClick={toggleAccountMenu}
                aria-expanded={accountOpen}
                aria-label={`Account: ${customerName}`}
                title={`Signed in as ${customerEmail || `customer #${customerId || "—"}`}`}
                className="inline-flex h-10 max-w-[158px] items-center gap-1.5 rounded-full bg-[#eff4ff] px-3 text-[#0b1c30] transition-colors hover:bg-[#dce9ff]"
              >
                <span className="material-symbols-outlined text-[19px] text-[#006948]">account_circle</span>
                <span className="hidden text-left leading-tight sm:block"><span className="block text-[9px] font-semibold uppercase tracking-wide text-[#5c647a]">Account</span><span className="block max-w-[94px] truncate text-[11px] font-bold">{customerName}</span></span>
              </button>
              {accountOpen && <div className="absolute right-0 top-[calc(100%+10px)] z-[100] w-72 max-w-[calc(100vw-24px)] rounded-2xl border border-[#e5eeff] bg-white p-4 text-[#0b1c30] shadow-xl">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#006948]">Customer profile</span>
                  {!profileEditing && <button type="button" onClick={() => setProfileEditing(true)} className="rounded-full bg-[#eff4ff] px-3 py-1.5 text-[10px] font-bold text-[#006948]">Edit</button>}
                </div>
                {profileEditing ? <div className="mt-3 space-y-3">
                  <label className="block text-[11px] font-semibold text-[#526276]">Full name<input autoFocus value={profileDraft.full_name} onChange={(event) => setProfileDraft((current) => ({ ...current, full_name: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#dce5ef] px-3 py-2 text-[12px] text-[#0b1c30] outline-none focus:border-[#006948]" /></label>
                  <label className="block text-[11px] font-semibold text-[#526276]">Phone number<input type="tel" maxLength={30} value={profileDraft.phone} onChange={(event) => setProfileDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Add a phone number" className="mt-1 w-full rounded-lg border border-[#dce5ef] px-3 py-2 text-[12px] text-[#0b1c30] outline-none focus:border-[#006948]" /></label>
                  <div className="text-[11px] text-[#526276]">Email <span className="mt-1 block break-all font-medium text-[#0b1c30]">{customerEmail || `Customer account #${customerId || "—"}`}</span><span className="mt-1 block text-[10px]">Email changes require verification.</span></div>
                  <div className="flex gap-2"><button type="button" onClick={() => { setProfileEditing(false); setProfileDraft({ full_name: customerName, phone: localStorage.getItem("nexcart_customer_phone") || "" }); }} className="flex-1 rounded-full bg-[#eff4ff] px-3 py-2 text-[11px] font-bold text-[#344054]">Cancel</button><button type="button" onClick={saveCustomerProfile} disabled={savingProfile} className="flex-1 rounded-full bg-[#006948] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60">{savingProfile ? "Saving…" : "Save changes"}</button></div>
                </div> : <>
                  <strong className="mt-2 block truncate text-[14px]">{customerName}</strong>
                  <span className="mt-1 block break-all text-[12px] text-[#5c647a]">{customerEmail || `Customer account #${customerId || "—"}`}</span>
                  {localStorage.getItem("nexcart_customer_phone") && <span className="mt-1 block text-[11px] text-[#5c647a]">{localStorage.getItem("nexcart_customer_phone")}</span>}
                </>}
              </div>}
            </div>
            <button
              onClick={() => {
                setCheckoutStep("cart");
                setCartOpen(true);
              }}
              className="relative inline-flex items-center gap-2 h-11 px-4 rounded-full bg-[#dce9ff] hover:bg-[#cbdbf5] text-[#0b1c30] font-semibold text-[13px] transition-colors"
            >
              <span className="material-symbols-outlined text-[20px] text-[#006948]">
                shopping_cart
              </span>
              <span className="hidden sm:inline">Bag</span>
              {cartCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[#006948] text-white text-[11px] font-bold">
                  {cartCount}
                </span>
              )}
            </button>

            <button
              onClick={handleLogout}
              title="Sign Out"
              className="w-11 h-11 rounded-full bg-[#eff4ff] hover:bg-[#ffdad6] text-[#3d4a42] hover:text-[#93000a] flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* VIEW 1 & 2: DISCOVER & WISHLIST */}
      {(activeView === "discover" || activeView === "wishlist") && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
          {activeView === "discover" && (
            <div className="relative mb-8 grid grid-cols-1 items-center gap-8 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#006948] via-[#005137] to-[#0b1c30] p-6 text-white shadow-md sm:p-9 md:grid-cols-[1.1fr_.9fr] md:p-10">
              <div className="pointer-events-none absolute -right-12 -top-20 h-72 w-72 rounded-full bg-[#68dba9]/15 blur-2xl" />
              <div className="relative z-10 max-w-xl">
                <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1 text-[11.5px] font-bold tracking-wide text-[#85f8c4] backdrop-blur-md">
                  <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
                  GOOD FINDS, PICKED FOR YOU
                </span>
                <h1 className="text-[30px] font-bold leading-tight tracking-tight sm:text-[38px]">
                  Welcome, {customerName}.
                </h1>
                <p className="mt-2.5 max-w-lg text-[14.5px] leading-relaxed text-white/80">
                  Make today a little better with great finds from NexCart sellers. Shop at your pace and get every order delivered with OTP security.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => { setActiveView("discover"); setSelectedCategory("All"); document.getElementById("product-catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#85f8c4] px-5 py-2.5 text-[13px] font-bold text-[#002114] transition-all hover:brightness-105"
                  >
                    <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                    Explore products
                  </button>
                  <button
                    onClick={() => setActiveView("orders")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/20"
                  >
                    <span className="material-symbols-outlined text-[18px]">local_shipping</span>
                    My Orders ({activeOrderCount})
                  </button>
                </div>
              </div>

              <div className="relative z-10 mx-auto w-full max-w-md md:ml-auto">
                <div className="rounded-[24px] border border-white/60 bg-white p-3.5 text-[#0b1c30] shadow-[0_18px_50px_rgba(0,20,12,0.24)] sm:p-4">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#006948]">Featured find</span>
                    {featuredProduct?.discount_price && featuredProduct.discount_price < featuredProduct.price && (
                      <span className="rounded-full bg-[#d9fbe9] px-2.5 py-1 text-[10px] font-extrabold text-[#006948]">
                        SAVE {Math.round(((featuredProduct.price - featuredProduct.discount_price) / featuredProduct.price) * 100)}%
                      </span>
                    )}
                  </div>
                  {featuredProduct ? (
                    <button
                      type="button"
                      onClick={() => { setQuickViewProduct(featuredProduct); setActiveImageIdx(0); }}
                      className="grid w-full grid-cols-[112px_1fr] items-center gap-4 rounded-[18px] bg-[#f4f8f5] p-3 text-left transition-colors hover:bg-[#eaf5ee] sm:grid-cols-[132px_1fr] sm:p-4"
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-2xl bg-white sm:h-32">
                        {featuredProduct.image_url ? <img src={featuredProduct.image_url} alt={featuredProduct.name} className="h-full w-full object-cover" /> : <span className="material-symbols-outlined text-4xl text-[#006948]">redeem</span>}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5c647a]">{featuredProduct.brand || featuredProduct.category || "From NexCart sellers"}</span>
                        <strong className="mt-1 block line-clamp-2 text-[15px] font-extrabold leading-snug sm:text-[17px]">{featuredProduct.name}</strong>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-[18px] font-extrabold text-[#006948]">₹{Number(featuredProduct.discount_price || featuredProduct.price).toLocaleString("en-IN")}</span>
                          {featuredProduct.discount_price && featuredProduct.discount_price < featuredProduct.price && <span className="text-[12px] text-[#7b8494] line-through">₹{Number(featuredProduct.price).toLocaleString("en-IN")}</span>}
                        </div>
                        <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#006948]">See this find <span className="material-symbols-outlined text-[15px]">arrow_forward</span></span>
                      </div>
                    </button>
                  ) : (
                    <div className="flex min-h-36 items-center gap-4 rounded-[18px] bg-[#f4f8f5] p-5">
                      <span className="material-symbols-outlined text-5xl text-[#006948]">redeem</span>
                      <div><strong className="block text-[16px]">Your next great find is here.</strong><span className="text-[12px] text-[#5c647a]">New products from local sellers will show up here.</span></div>
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-semibold text-[#5c647a]"><span className="material-symbols-outlined text-[15px] text-[#006948]">verified_user</span>Secure checkout · Track every order</div>
                </div>
              </div>
            </div>
          )}

          {/* Category Filter Chips + Sort */}
          <div id="product-catalog" className="flex scroll-mt-24 flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {categoryList.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-4 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap transition-all ${
                      active
                        ? "bg-[#006948] text-white shadow-sm"
                        : "bg-[#eff4ff] text-[#3d4a42] hover:bg-[#dce9ff]"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <span className="text-[12px] text-[#5c647a] font-medium">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-9 px-3.5 rounded-full bg-[#eff4ff] text-[12.5px] font-semibold text-[#0b1c30] focus:outline-none cursor-pointer"
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
            </div>
          </div>

          {/* Live product grid */}
          {filteredProducts.length === 0 ? (
            <div className="rounded-[28px] bg-white p-14 text-center shadow-sm">
              <span className="material-symbols-outlined text-[48px] text-[#6d7a72] mb-2">
                {products.length ? "search_off" : "local_mall"}
              </span>
              <h3 className="text-[18px] font-bold text-[#0b1c30]">
                {products.length ? "No products match your search" : "Fresh finds are on the way"}
              </h3>
              <p className="text-[13.5px] text-[#5c647a] mt-1 max-w-md mx-auto">
                {products.length ? "Try a different search or category to find what you need." : "We’re getting the store ready. Check back soon for new products."}
              </p>
              {products.length > 0 && (searchQuery || selectedCategory !== "All") && (
                <button type="button" onClick={() => { setSearchQuery(""); setSelectedCategory("All"); }} className="mt-4 rounded-full bg-[#006948] px-5 py-2.5 text-[12px] font-bold text-white hover:bg-[#00855d]">
                  Clear search and filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filteredProducts.map((product) => {
                const hasDiscount =
                  product.discount_price && product.discount_price < product.price;
                const displayPrice = hasDiscount ? product.discount_price : product.price;
                const discountPct = hasDiscount
                  ? Math.round(((product.price - product.discount_price) / product.price) * 100)
                  : 0;
                const isSaved = wishlist.includes(product.id);
                const cardImage = product.image_url;

                return (
                  <div
                    key={product.id}
                    className="group rounded-[24px] bg-white p-3.5 shadow-[0_2px_12px_rgba(11,28,48,0.04)] hover:shadow-[0_12px_28px_rgba(11,28,48,0.09)] transition-all flex flex-col justify-between border border-[#eff4ff]"
                  >
                    <div>
                      <div
                        onClick={() => {
                          setEditingCartItem(null);
                          setQuickViewProduct(product);
                          setActiveImageIdx(0);
                        }}
                        className="relative aspect-[4/3] rounded-[18px] bg-[#eff4ff] overflow-hidden cursor-pointer mb-3.5 flex items-center justify-center"
                      >
                        {cardImage ? (
                          <img
                            src={cardImage}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <span className="material-symbols-outlined text-[44px] text-[#6d7a72]">
                            image
                          </span>
                        )}

                        {discountPct > 0 && (
                          <span className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-[#85f8c4] text-[#002114] text-[11px] font-extrabold shadow-sm">
                            -{discountPct}% OFF
                          </span>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWishlist(product.id);
                          }}
                          className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-white/90 backdrop-blur-md flex items-center justify-center shadow-sm hover:scale-105 transition-transform"
                        >
                          <span
                            className={`material-symbols-outlined text-[19px] ${
                              isSaved ? "text-[#ba1a1a]" : "text-[#3d4a42]"
                            }`}
                            style={{ fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0" }}
                          >
                            favorite
                          </span>
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-semibold text-[#5c647a] px-1">
                        <span>{product.brand || product.category || product.category_name}</span>
                        <span
                          className={
                            product.stock > 0 ? "text-[#006948]" : "text-[#ba1a1a]"
                          }
                        >
                          {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
                        </span>
                      </div>

                      <h3
                        onClick={() => {
                          setEditingCartItem(null);
                          setQuickViewProduct(product);
                          setActiveImageIdx(0);
                        }}
                        className="text-[15px] font-bold text-[#0b1c30] mt-1 px-1 line-clamp-2 cursor-pointer hover:text-[#006948] transition-colors"
                      >
                        {product.name}
                      </h3>
                    </div>

                    <div className="pt-4 mt-3 border-t border-[#eff4ff] flex items-center justify-between px-1">
                      <div>
                        <div className="text-[18px] font-extrabold text-[#0b1c30]">
                          ₹{displayPrice.toLocaleString("en-IN")}
                        </div>
                        {hasDiscount && (
                          <div className="text-[11.5px] line-through text-[#6d7a72]">
                            ₹{product.price.toLocaleString("en-IN")}
                          </div>
                        )}
                      </div>

                      <button
                        disabled={product.stock <= 0}
                        onClick={() => {
                          const defaultOptions = product.variant_configurations?.find((configuration) => configuration.options)?.options
                            || Object.fromEntries(getProductOptions(product).map(({ key, choices }) => [key, choices[0]]));
                          addToCart(product, defaultOptions);
                        }}
                        className={`h-10 px-4 rounded-full text-[12.5px] font-bold inline-flex items-center gap-1.5 transition-all ${
                          product.stock <= 0
                            ? "bg-[#e5eeff] text-[#6d7a72] cursor-not-allowed"
                            : "bg-[#006948] hover:bg-[#00855d] text-white shadow-sm active:scale-95"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[17px]">
                          add_shopping_cart
                        </span>
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* VIEW 3: LIVE ORDERS */}
      {activeView === "orders" && (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-[24px] font-bold text-[#0b1c30]">My Orders &amp; Live Tracking</h2>
              <p className="text-[13.5px] text-[#5c647a]">
                Real-time order status and 4-digit delivery handover PIN.
              </p>
            </div>
            <button
              onClick={fetchStoreData}
              className="px-4 py-2 rounded-full bg-[#eff4ff] hover:bg-[#dce9ff] text-[#006948] text-[12.5px] font-bold inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[17px]">refresh</span>
              Refresh
            </button>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setOrderFilter("active")} className={`rounded-full px-4 py-2 text-[12px] font-bold ${orderFilter === "active" ? "bg-[#006948] text-white" : "bg-white text-[#3d4a42] hover:bg-[#eff4ff]"}`}>
              Active orders ({activeOrderCount})
            </button>
            <button type="button" onClick={() => setOrderFilter("cancelled")} className={`rounded-full px-4 py-2 text-[12px] font-bold ${orderFilter === "cancelled" ? "bg-[#a11b1b] text-white" : "bg-white text-[#3d4a42] hover:bg-[#fff0ef]"}`}>
              Cancelled ({cancelledOrderCount})
            </button>
          </div>

          {visibleOrders.length === 0 ? (
            <div className="rounded-[28px] bg-white p-12 text-center shadow-sm">
              <span className="material-symbols-outlined text-[46px] text-[#6d7a72]">
                {orderFilter === "cancelled" ? "history" : "local_shipping"}
              </span>
              <h3 className="text-[17px] font-bold mt-2">{orderFilter === "cancelled" ? "No cancelled orders" : "No active orders"}</h3>
              {orderFilter === "active" && <button onClick={() => setActiveView("discover")} className="mt-4 rounded-full bg-[#006948] px-5 py-2.5 text-[13px] font-bold text-white">Explore Catalog</button>}
            </div>
          ) : (
            <div className="space-y-4">
              {visibleOrders.map((ord) => {
                const currentIdx = ORDER_STEPS.indexOf(ord.status);
                const canEditOrder = ord.can_cancel ?? (ord.status === "Processing");
                const mapQuery = ord.delivery_lat != null && ord.delivery_lng != null
                  ? `${ord.delivery_lat},${ord.delivery_lng}`
                  : ord.shipping_address;
                return (
                  <div
                    key={ord.id}
                    className="overflow-hidden rounded-[24px] border border-[#e5eeff] bg-white shadow-[0_8px_28px_rgba(11,28,48,.05)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#eff4ff] bg-gradient-to-r from-white to-[#f7fbff] p-5 sm:p-6">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[17px] font-extrabold text-[#0b1c30]">{ord.order_number}</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${ord.status === "Cancelled" ? "bg-[#ffdad6] text-[#93000a]" : ord.status === "Delivered" ? "bg-[#d9fbe9] text-[#006948]" : "bg-[#dce9ff] text-[#006948]"}`}>{ord.status}</span>
                          {ord.payment_method && <span className="rounded-full bg-[#eff4ff] px-2.5 py-1 text-[10px] font-bold text-[#3d4a42]">{ord.payment_method}</span>}
                        </div>
                        <p className="mt-1.5 text-[11px] text-[#7b8494]">Placed {ord.created_at ? new Date(ord.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {ord.status !== "Delivered" && ord.status !== "Cancelled" && ord.delivery_otp && <div className="rounded-2xl border border-[#cfe7d8] bg-[#f0fff6] px-3.5 py-2 text-center"><span className="block text-[9px] font-extrabold uppercase tracking-wider text-[#4d6659]">Handover OTP</span><span className="text-[18px] font-black tracking-[.2em] text-[#006948]">{ord.delivery_otp}</span></div>}
                        <div className="text-right"><span className="block text-[10px] text-[#7b8494]">Order total</span><span className="text-[18px] font-extrabold text-[#0b1c30]">₹{Number(ord.total_amount || 0).toLocaleString("en-IN")}</span></div>
                      </div>
                    </div>

                    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_230px]">
                      <div className="space-y-5">
                        <div className="flex items-start gap-3 rounded-2xl bg-[#f7f9ff] p-3.5">
                          <span className="material-symbols-outlined mt-0.5 text-[20px] text-[#006948]">location_on</span>
                          <div className="min-w-0 flex-1"><span className="block text-[10px] font-extrabold uppercase tracking-wider text-[#5c647a]">Delivering to</span><p className="mt-1 text-[12px] leading-relaxed text-[#0b1c30]">{ord.shipping_address}</p>{ord.delivery_lat != null && ord.delivery_lng != null && <span className="mt-1 block text-[10px] text-[#006948]">Location pin saved · {Number(ord.delivery_lat).toFixed(4)}, {Number(ord.delivery_lng).toFixed(4)}</span>}</div>
                          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery || "")}`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-2 text-[10px] font-bold text-[#006948] shadow-sm"><span className="material-symbols-outlined text-[15px]">map</span>Map</a>
                        </div>

                        {addressEditingOrderId === ord.id && <div className="rounded-2xl border border-[#cfe7d8] bg-[#f8fffb] p-4">
                          <label className="block text-[11px] font-bold text-[#0b1c30]">New delivery address<textarea value={addressDraft} onChange={(event) => setAddressDraft(event.target.value)} rows={2} maxLength={500} className="mt-1.5 w-full rounded-xl border border-[#dbe6df] bg-white p-3 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#006948]" placeholder="Street, area, city, postal code" /></label>
                          <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={useCurrentLocation} className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7ef] px-3 py-2 text-[10px] font-bold text-[#006948]"><span className="material-symbols-outlined text-[15px]">my_location</span>{locationDraft ? "Update location pin" : "Use current location"}</button>{locationDraft && <span className="text-[10px] text-[#5c647a]">Pin: {locationDraft.lat.toFixed(5)}, {locationDraft.lng.toFixed(5)}</span>}<div className="ml-auto flex gap-2"><button type="button" onClick={() => setAddressEditingOrderId(null)} className="rounded-full px-3 py-2 text-[10px] font-bold text-[#5c647a]">Cancel</button><button type="button" disabled={savingOrderAction} onClick={() => saveOrderAddress(ord)} className="rounded-full bg-[#006948] px-4 py-2 text-[10px] font-bold text-white disabled:opacity-50">{savingOrderAction ? "Saving…" : "Save address"}</button></div></div>
                        </div>}

                        <div><div className="mb-2 flex items-center justify-between"><h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[#5c647a]">Items in this order</h3><span className="text-[10px] text-[#7b8494]">{(ord.items || []).reduce((sum, item) => sum + item.quantity, 0)} item(s)</span></div><div className="divide-y divide-[#eff4ff] rounded-2xl border border-[#eff4ff] px-3">{(ord.items || []).map((item, index) => <div key={`${item.product_id || item.product_name}-${index}`} className="flex items-center gap-3 py-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f0f3ff]">{item.image_url ? <img src={item.image_url} alt="" className="h-full w-full object-cover" /> : <span className="material-symbols-outlined text-[#718096]">inventory_2</span>}</div><div className="min-w-0 flex-1"><strong className="block truncate text-[12px] text-[#0b1c30]">{item.product_name}</strong><span className="text-[10px] text-[#7b8494]">Qty {item.quantity} · ₹{Number(item.unit_price || 0).toLocaleString("en-IN")} each</span></div><strong className="text-[12px] text-[#0b1c30]">₹{Number(item.subtotal || 0).toLocaleString("en-IN")}</strong></div>)}</div></div>

                        {ord.status !== "Cancelled" && <div><div className="mb-2 flex items-center justify-between"><h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[#5c647a]">Order progress</h3><span className="text-[10px] font-semibold text-[#006948]">{ord.status}</span></div><div className="grid grid-cols-5 gap-2">{ORDER_STEPS.map((step, index) => { const done = currentIdx >= index; return <div key={step} className="space-y-1.5"><div className={`h-1.5 rounded-full ${done ? "bg-[#00855d]" : "bg-[#e5eeff]"}`} /><span className={`block text-[9px] font-semibold leading-tight sm:text-[10px] ${done ? "text-[#0b1c30]" : "text-[#8a94a5]"}`}>{step}</span></div>; })}</div></div>}

                        {!!ord.timeline?.length && <details className="rounded-xl bg-[#f7f9ff] px-4 py-3"><summary className="cursor-pointer text-[11px] font-bold text-[#006948]">View order updates ({ord.timeline.length})</summary><div className="mt-3 space-y-3 border-l-2 border-[#cfe7d8] pl-3">{[...ord.timeline].reverse().map((event, index) => <div key={`${event.status}-${index}`}><strong className="block text-[10px] text-[#0b1c30]">{event.status}</strong><span className="block text-[10px] text-[#5c647a]">{event.note}</span><time className="text-[9px] text-[#9099a8]">{event.created_at ? new Date(event.created_at).toLocaleString() : ""}</time></div>)}</div></details>}
                      </div>

                      <aside className="flex flex-col gap-2 rounded-2xl bg-[#f7f9ff] p-4 lg:self-start">
                        <span className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-[#5c647a]">Order actions</span>
                        {canEditOrder && <button type="button" onClick={() => addressEditingOrderId === ord.id ? setAddressEditingOrderId(null) : startAddressEdit(ord)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#dfe7f4] bg-white px-3 py-2.5 text-[11px] font-bold text-[#0b1c30] hover:border-[#006948]"><span className="material-symbols-outlined text-[16px]">edit_location_alt</span>Change address</button>}
                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery || "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#dfe7f4] bg-white px-3 py-2.5 text-[11px] font-bold text-[#0b1c30] hover:border-[#006948]"><span className="material-symbols-outlined text-[16px]">directions</span>Get directions</a>
                        {ord.rider_phone && <a href={`tel:${ord.rider_phone}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#dfe7f4] bg-white px-3 py-2.5 text-[11px] font-bold text-[#0b1c30] hover:border-[#006948]"><span className="material-symbols-outlined text-[16px]">call</span>Call delivery partner</a>}
                        <button type="button" disabled={savingOrderAction || !ord.items?.length} onClick={() => reorder(ord)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#006948] px-3 py-2.5 text-[11px] font-bold text-white hover:bg-[#00855d] disabled:opacity-50"><span className="material-symbols-outlined text-[16px]">replay</span>Order these items again</button>
                        {canEditOrder && <button type="button" disabled={savingOrderAction} onClick={() => cancelOrder(ord)} className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#f2c9c5] bg-white px-3 py-2.5 text-[11px] font-bold text-[#a11b1b] hover:bg-[#fff4f3] disabled:opacity-50"><span className="material-symbols-outlined text-[16px]">cancel</span>Cancel order</button>}
                        {ord.status === "Cancelled" && <p className="mt-1 rounded-xl bg-[#fff0ef] p-3 text-[10px] leading-relaxed text-[#8a2925]">This order was cancelled. If prepaid, its payment is marked for refund follow-up.</p>}
                        {ord.status === "Delivered" && <p className="mt-1 rounded-xl bg-[#e9f7ef] p-3 text-[10px] leading-relaxed text-[#286243]">Delivered{ord.delivered_at ? ` on ${new Date(ord.delivered_at).toLocaleString()}` : " successfully"}.</p>}
                      </aside>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* PRODUCT QUICK-VIEW MODAL */}
      {quickViewProduct && (
        <div className="fixed inset-0 z-50 bg-[#0b1c30]/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[28px] max-w-3xl w-full overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-2">
            <div className="bg-[#eff4ff] p-6 flex flex-col justify-between">
              {(() => {
                const baseImgs =
                  quickViewProduct.gallery_images && quickViewProduct.gallery_images.length > 0
                    ? quickViewProduct.gallery_images
                    : quickViewProduct.image_url
                    ? [quickViewProduct.image_url]
                    : [];
                const variantImgs = getSelectedVariantImages(quickViewProduct, selectedVariantOptions);
                // Use a variant-specific gallery when one exists; otherwise keep
                // the product's main gallery visible instead of showing an empty
                // image placeholder for variants without assigned images.
                const imgs = variantImgs.length ? variantImgs : baseImgs;
                const displayedImage = imgs[activeImageIdx] || imgs[0];
                const displayedIndex = imgs.indexOf(displayedImage);
                return (
                  <>
                    <div className="aspect-square rounded-[20px] bg-white overflow-hidden shadow-sm flex items-center justify-center">
                      {imgs.length > 0 ? (
                        <img
                          src={displayedImage}
                          alt={quickViewProduct.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="material-symbols-outlined text-[56px] text-[#6d7a72]">
                          image
                        </span>
                      )}
                    </div>
                    {imgs.length > 1 && (
                      <div className="flex gap-2 mt-3">
                        {imgs.map((src, i) => (
                          <button
                            key={i}
                            onClick={() => setActiveImageIdx(i)}
                            className={`w-14 h-14 rounded-xl overflow-hidden border-2 ${
                              (displayedIndex >= 0 ? displayedIndex : activeImageIdx) === i ? "border-[#006948]" : "border-transparent"
                            }`}
                          >
                            <img src={src} alt="thumb" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div ref={productDetailsRef} className="p-6 flex flex-col justify-between max-h-[85vh] overflow-y-auto">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="px-3 py-1 rounded-full bg-[#eff4ff] text-[#006948] text-[11px] font-bold">
                    {quickViewProduct.brand || quickViewProduct.category || quickViewProduct.category_name}
                  </span>
                  <button
                    onClick={() => setQuickViewProduct(null)}
                    className="w-8 h-8 rounded-full bg-[#eff4ff] flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                <h2 className="text-[21px] sm:text-[24px] leading-snug font-bold text-[#0b1c30] mt-4">
                  {quickViewProduct.name}
                </h2>
                {getProductOptions(quickViewProduct).filter(({ key }) => isColorOption(quickViewProduct, key)).map(({ key }) => {
                  const choices = getAvailableOptionChoices(quickViewProduct, key, selectedVariantOptions);
                  return <section key={key} className="mt-4 rounded-2xl border border-[#e5eaf1] bg-white p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[13px] font-bold text-[#041e49]">Choose color</span>
                      <span className="text-[11px] font-medium text-[#5c647a]">{selectedVariantOptions[key] || "Select a color"}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {choices.map((choice) => {
                        const selected = selectedVariantOptions[key] === choice;
                        const optionImage = getOptionChoiceImage(quickViewProduct, selectedVariantOptions, key, choice);
                        return <button key={choice} type="button" aria-label={`Choose ${choice}`} aria-pressed={selected} onClick={() => chooseVariantOption(key, choice)} className={`flex min-w-[76px] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition ${selected ? "bg-[#fff7ed] text-[#c2410c] ring-2 ring-[#f97316]" : "bg-white text-[#344054] ring-1 ring-[#dfe4eb] hover:ring-[#9aa6b2]"}`}>
                          {optionImage ? <img src={optionImage} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg border border-black/10" style={{ backgroundColor: getSwatchColor(choice) }} />}
                          <span className="max-w-[90px] text-center leading-tight">{choice}</span>
                        </button>;
                      })}
                    </div>
                  </section>;
                })}
                {quickViewProduct.description && (
                  <p className="text-[13px] text-[#536158] mt-3 leading-[1.75]">
                    {quickViewProduct.description}
                  </p>
                )}

                {quickViewProduct.highlights && quickViewProduct.highlights.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#5c647a]">
                      Key Highlights
                    </span>
                    {quickViewProduct.highlights.map((h, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-[12.5px] text-[#0b1c30]">
                        <span className="material-symbols-outlined text-[#006948] text-[16px]">
                          check_circle
                        </span>
                        <span>{h}</span>
                      </div>
                    ))}
                  </div>
                )}

                {Object.entries({
                  emi_offer: ["EMI options", "payments"],
                  special_offer: ["Special offer", "local_offer"],
                  replacement_policy: ["Replacement policy", "autorenew"],
                  coupon_offer: ["Coupon offer", "confirmation_number"],
                }).filter(([key]) => key === "coupon_offer" ? quickViewProduct.admin_terms?.coupon_code && Number(quickViewProduct.admin_terms?.coupon_percent) > 0 : quickViewProduct.admin_terms?.[key]?.trim()).length > 0 && (
                  <section className="mt-4 space-y-2 rounded-2xl border border-[#dcebe3] bg-[#f5fbf7] p-4">
                    {Object.entries({
                      emi_offer: ["EMI options", "payments"],
                      special_offer: ["Special offer", "local_offer"],
                      replacement_policy: ["Replacement policy", "autorenew"],
                      coupon_offer: ["Coupon offer", "confirmation_number"],
                    }).filter(([key]) => key === "coupon_offer" ? quickViewProduct.admin_terms?.coupon_code && Number(quickViewProduct.admin_terms?.coupon_percent) > 0 : quickViewProduct.admin_terms?.[key]?.trim()).map(([key, [label, icon]]) => (
                      <div key={key} className="flex gap-2 text-[12px] leading-relaxed text-[#344b3d]">
                        <span className="material-symbols-outlined mt-0.5 text-[16px] text-[#08724f]">{icon}</span>
                        <p><strong className="mr-1 text-[#173b2b]">{label}:</strong>{key === "coupon_offer" ? `${quickViewProduct.admin_terms.coupon_code} gives ${quickViewProduct.admin_terms.coupon_percent}% off this item.` : quickViewProduct.admin_terms[key]}</p>
                      </div>
                    ))}
                  </section>
                )}

                <section className="mt-5 rounded-2xl border border-[#e5eaf1] bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[14px] font-bold text-[#0b1c30]">Customer reviews</h3>
                      <p className="mt-1 text-[11px] text-[#64748b]">{productReviewData.review_count ? `${productReviewData.average_rating} / 5 · ${productReviewData.review_count} review${productReviewData.review_count === 1 ? "" : "s"}` : "No reviews yet"}</p>
                    </div>
                    <span className="text-[18px] tracking-wide text-amber-500" aria-label={`${productReviewData.average_rating} out of 5 stars`}>
                      {"★".repeat(Math.round(productReviewData.average_rating || 0))}{"☆".repeat(5 - Math.round(productReviewData.average_rating || 0))}
                    </span>
                  </div>

                  {reviewLoading ? <p className="mt-3 text-[12px] text-[#64748b]">Loading reviews…</p> : productReviewData.reviews.length > 0 && <div className="mt-3 max-h-44 space-y-3 overflow-y-auto border-t border-[#eff4ff] pt-3">
                    {productReviewData.reviews.map((review) => <article key={review.id} className="text-[12px]">
                      <div className="flex items-center justify-between gap-2"><strong className="text-[#0b1c30]">{review.customer_name}</strong><span className="text-amber-500">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></div>
                      {review.comment && <p className="mt-1 leading-relaxed text-[#536158]">{review.comment}</p>}
                      <small className="mt-1 block text-[10px] text-[#8a8494]">{review.created_at ? new Date(review.created_at).toLocaleDateString() : ""}</small>
                    </article>)}
                  </div>}

                  {!token ? <div className="mt-3 border-t border-[#eff4ff] pt-3"><p className="text-[12px] text-[#64748b]">Sign in and order this product to leave a review.</p><button type="button" onClick={() => navigate("/login")} className="mt-2 rounded-full bg-[#eff4ff] px-4 py-2 text-[11px] font-bold text-[#006948]">Sign in</button></div>
                    : productReviewData.can_review && <div className="mt-3 border-t border-[#eff4ff] pt-3">
                      <p className="text-[12px] font-bold text-[#0b1c30]">{productReviewData.my_review ? "Update your review" : "Rate this product"}</p>
                      <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Product rating">
                        {[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" role="radio" aria-checked={reviewRating === rating} aria-label={`${rating} star${rating === 1 ? "" : "s"}`} onClick={() => setReviewRating(rating)} className={`text-[24px] leading-none ${rating <= reviewRating ? "text-amber-500" : "text-slate-300"}`}>★</button>)}
                      </div>
                      <textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} maxLength={1200} rows={3} placeholder="Share your experience (optional)" className="mt-2 w-full resize-y rounded-xl border border-[#dfe4eb] p-3 text-[12px] text-[#0b1c30] outline-none focus:border-[#006948]" />
                      <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] text-[#8a8494]">Only customers who ordered this product can review it.</span><button type="button" disabled={reviewSaving} onClick={submitProductReview} className="shrink-0 rounded-full bg-[#006948] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#00855d] disabled:opacity-50">{reviewSaving ? "Saving…" : productReviewData.my_review ? "Update review" : "Submit review"}</button></div>
                    </div>}
                  {token && !productReviewData.can_review && <p className="mt-3 border-t border-[#eff4ff] pt-3 text-[11px] text-[#64748b]">Order this product to unlock the review form.</p>}
                </section>

                {getProductOptions(quickViewProduct).some(({ key }) => !isColorOption(quickViewProduct, key)) && (
                  <div className="mt-5 space-y-4 rounded-2xl border border-[#e5eaf1] bg-white p-4">
                    {getProductOptions(quickViewProduct).filter(({ key }) => !isColorOption(quickViewProduct, key)).map(({ key }) => {
                      const choices = getAvailableOptionChoices(quickViewProduct, key, selectedVariantOptions);
                      return (
                      <div key={key}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-[13px] font-bold text-[#041e49]">{key}</span>
                          <span className="text-[11px] text-[#5c647a]">Selected: {selectedVariantOptions[key]}</span>
                        </div>
                        <div className={`flex flex-wrap gap-2 ${isColorOption(quickViewProduct, key) ? "items-start" : "items-center"}`}>
                          {choices.map((choice) => {
                            const selected = selectedVariantOptions[key] === choice;
                            const isColor = isColorOption(quickViewProduct, key);
                            const optionImage = isColor ? getOptionChoiceImage(quickViewProduct, selectedVariantOptions, key, choice) : null;
                            return <button key={choice} type="button" aria-label={`${key}: ${choice}`} title={choice} aria-pressed={selected} onClick={() => chooseVariantOption(key, choice)} className={isColor ? `flex w-[80px] flex-col items-center gap-1 rounded-lg p-2 text-[11px] font-semibold transition ${selected ? "text-[#c2410c] ring-2 ring-[#f97316]" : "text-[#344054] ring-1 ring-[#e0e5ec] hover:ring-[#9aa6b2]"}` : `min-h-10 rounded-md px-4 text-[12px] font-semibold transition ${selected ? "border-2 border-[#0b57d0] bg-[#eef4ff] text-[#0b1c30]" : "border border-[#9aa6b2] bg-white text-[#344054] hover:border-[#0b57d0]"}`}>
                              {isColor ? <>
                                {optionImage ? <img src={optionImage} alt={`${choice} color`} className="h-12 w-12 rounded-md object-cover" /> : <span className="h-10 w-10 rounded-md border border-black/10" style={{ backgroundColor: getSwatchColor(choice) }} />}
                                <span className="max-w-full text-center leading-tight">{choice}</span>
                              </> : choice}
                            </button>;
                          })}
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}

                {quickViewProduct.specifications &&
                  Object.entries(quickViewProduct.specifications).filter(([key]) => !SELECTABLE_OPTION_KEY.test(key)).length > 0 && (
                    <div className="mt-4 rounded-2xl bg-[#eff4ff] p-3.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#5c647a] block mb-2">
                        Specifications
                      </span>
                      <div className="space-y-2 text-[12px]">
                        {Object.entries(quickViewProduct.specifications).filter(([key]) => !SELECTABLE_OPTION_KEY.test(key)).map(([k, v]) => (
                          <div key={k} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 items-start">
                            <span className="text-[#5c647a] font-medium leading-relaxed">{k}</span>
                            <span className="font-semibold text-[#0b1c30] leading-relaxed break-words">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>

              <div className="pt-5 mt-5 border-t border-[#eff4ff] flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-[#5c647a] block">Price</span>
                  <span className="text-[22px] font-extrabold text-[#0b1c30]">
                    ₹
                    {Number(getSelectedConfiguration(quickViewProduct, selectedVariantOptions)?.price ?? quickViewProduct.discount_price ?? quickViewProduct.price).toLocaleString("en-IN")}
                  </span>
                </div>
                <button
                  disabled={quickViewProduct.stock <= 0}
                  onClick={() => {
                    const requiredOptions = getProductOptions(quickViewProduct);
                    if (requiredOptions.some(({ key }) => !selectedVariantOptions[key])) {
                      notify("Choose each product option before adding it to your bag.");
                      return;
                    }
                    if (editingCartItem) {
                      updateCartVariant(quickViewProduct, selectedVariantOptions);
                    } else {
                      addToCart(quickViewProduct, selectedVariantOptions).then((added) => { if (added) setQuickViewProduct(null); });
                    }
                  }}
                  className="px-6 py-3 rounded-full bg-[#006948] hover:bg-[#00855d] text-white font-bold text-[13.5px] inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                  {editingCartItem ? "Update bag item" : "Add to Bag"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SLIDE-OVER CART -> ADDRESS -> PAYMENT -> SUCCESS DRAWER */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-[#0b1c30]/50 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between">
            <div className="px-6 py-5 border-b border-[#eff4ff] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#006948]">
                  {checkoutStep === "cart" && "Step 1 of 4 • Shopping Bag"}
                  {checkoutStep === "address" && "Step 2 of 4 • Delivery Location"}
                  {checkoutStep === "review" && "Step 3 of 4 • Review your order"}
                  {checkoutStep === "payment" && "Step 4 of 4 • Payment"}
                  {checkoutStep === "success" && "Order Confirmed"}
                </span>
                <h2 className="text-[20px] font-bold text-[#0b1c30]">
                  {checkoutStep === "cart" && `Your Bag (${cartCount})`}
                  {checkoutStep === "address" && "Delivery Address"}
                  {checkoutStep === "review" && "Check your details"}
                  {checkoutStep === "payment" && "Offers & payment"}
                  {checkoutStep === "success" && "Order Placed!"}
                </h2>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="w-9 h-9 rounded-full bg-[#eff4ff] flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* STEP 1: CART */}
              {checkoutStep === "cart" && (
                <>
                  {cart.length === 0 ? (
                    <div className="text-center py-16">
                      <span className="material-symbols-outlined text-[48px] text-[#6d7a72]">
                        shopping_bag
                      </span>
                      <p className="text-[14px] font-semibold text-[#3d4a42] mt-2">
                        Your bag is empty
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cart.map((item) => (
                        <div
                          key={item.cart_item_id || item.id}
                          className="p-3.5 rounded-2xl bg-[#eff4ff] flex items-center gap-3.5"
                        >
                          <div className="w-16 h-16 rounded-xl bg-white overflow-hidden shrink-0 flex items-center justify-center">
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt={item.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="material-symbols-outlined text-[#6d7a72]">
                                image
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-[13.5px] font-bold text-[#0b1c30] truncate">
                              {item.name}
                            </h4>
                            {Object.keys(item.variant_options || {}).length > 0 && <span className="mt-1 block text-[10px] text-[#5c647a]">{Object.entries(item.variant_options).map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>}
                            <span className="text-[13px] font-extrabold text-[#006948]">
                              ₹{(item.price * item.qty).toLocaleString("en-IN")}
                            </span>
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={() => updateCartQty(item.cart_item_id, -1)}
                                className="w-7 h-7 rounded-full bg-white text-[#0b1c30] font-bold shadow-sm"
                              >
                                −
                              </button>
                              <span className="text-[13px] font-bold w-6 text-center">
                                {item.qty}
                              </span>
                              <button
                                onClick={() => updateCartQty(item.cart_item_id, 1)}
                                className="w-7 h-7 rounded-full bg-white text-[#0b1c30] font-bold shadow-sm"
                              >
                                +
                              </button>
                            </div>
                            <div className="mt-2 flex gap-3">
                              {getProductOptions(products.find((product) => product.id === item.id)).length > 0 && <button type="button" onClick={() => {
                                const product = products.find((entry) => entry.id === item.id);
                                if (!product) return notify("This product is no longer available.");
                                setEditingCartItem(item);
                                setCatalogVariantSelections((current) => ({ ...current, [item.id]: item.variant_options || {} }));
                                setActiveImageIdx(0);
                                setCartOpen(false);
                                setQuickViewProduct(product);
                              }} className="text-[10px] font-bold text-[#006948]">Change options</button>}
                              <button type="button" onClick={() => updateCartQty(item.cart_item_id, -item.qty)} className="text-[10px] font-semibold text-[#a11b1b]">Remove</button>
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="mt-6 p-4 rounded-2xl bg-[#f8f9ff] border border-[#dce9ff] space-y-2 text-[13px]">
                        <div className="flex justify-between text-[#3d4a42]">
                          <span>Subtotal</span>
                          <span className="font-semibold">₹{subtotal.toLocaleString("en-IN")}</span>
                        </div>
                        {totalSavings > 0 && (
                          <div className="flex justify-between text-[#006948] font-semibold">
                            <span>Discount Savings</span>
                            <span>−₹{totalSavings.toLocaleString("en-IN")}</span>
                          </div>
                        )}
                        {couponDiscount > 0 && <div className="flex justify-between font-semibold text-[#006948]"><span>Coupon {couponCode}</span><span>−₹{couponDiscount.toLocaleString("en-IN")}</span></div>}
                        <div className="flex justify-between text-[#3d4a42]">
                          <span>Delivery Fee</span>
                          <span className="font-semibold text-[#006948]">
                            {deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`}
                          </span>
                        </div>
                        <div className="pt-2 border-t border-[#dce9ff] flex justify-between text-[16px] font-extrabold text-[#0b1c30]">
                          <span>Total Payable</span>
                          <span>₹{payableTotal.toLocaleString("en-IN")}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* STEP 2: ADDRESS */}
              {checkoutStep === "address" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-[#eff4ff] space-y-3">
                    <label className="text-[12px] font-bold text-[#0b1c30] flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[#006948] text-[18px]">
                        location_on
                      </span>
                      Doorstep Delivery Address *
                    </label>
                    <textarea
                      rows={3}
                      required
                      placeholder="Enter street, area, city, and pincode..."
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      className="w-full p-3 rounded-xl bg-white text-[13px] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006948]"
                    />
                  </div>

                  {savedAddresses.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#5c647a]">
                        Previously Used Addresses
                      </span>
                      {savedAddresses.map((addr) => (
                        <button
                          key={addr}
                          type="button"
                          onClick={() => setShippingAddress(addr)}
                          className="w-full text-left p-3 rounded-xl bg-[#f8f9ff] hover:bg-[#eff4ff] border border-[#dce9ff] text-[12.5px] text-[#0b1c30] font-medium"
                        >
                          {addr}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 3: ORDER REVIEW */}
              {checkoutStep === "review" && (
                <div className="space-y-4">
                  <section className="rounded-2xl border border-[#dce9ff] bg-[#f8f9ff] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="text-[13px] font-bold text-[#0b1c30]">Delivery address</h3><p className="mt-1 text-[12px] leading-relaxed text-[#526276]">{shippingAddress}</p></div>
                      <button type="button" onClick={() => setCheckoutStep("address")} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-[#006948] ring-1 ring-[#dce9ff]">Edit</button>
                    </div>
                  </section>
                  <section className="rounded-2xl border border-[#dce9ff] bg-white p-4">
                    <div className="mb-3 flex items-center justify-between"><h3 className="text-[13px] font-bold text-[#0b1c30]">Items ({cartCount})</h3><button type="button" onClick={() => setCheckoutStep("cart")} className="rounded-full bg-[#eff4ff] px-3 py-1.5 text-[11px] font-bold text-[#006948]">Edit bag</button></div>
                    <div className="space-y-3">
                      {cart.map((item) => {
                        const product = products.find((entry) => entry.id === item.id);
                        const terms = product?.admin_terms || {};
                        return <div key={item.cart_item_id || item.id} className="flex gap-3 border-b border-[#eff4ff] pb-3 last:border-0 last:pb-0">
                          <img src={item.image_url || product?.image_url || ""} alt={item.name} className="h-14 w-14 rounded-xl bg-[#eff4ff] object-cover" />
                          <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold text-[#0b1c30]">{item.name}</p><p className="mt-0.5 text-[10px] text-[#64748b]">{Object.entries(item.variant_options || {}).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Standard option"} · Qty {item.qty}</p><p className="mt-1 text-[12px] font-bold text-[#006948]">₹{(item.price * item.qty).toLocaleString("en-IN")}</p>
                            {(terms.special_offer || terms.emi_offer || terms.replacement_policy) && <p className="mt-1 line-clamp-2 text-[10px] text-[#526276]">{[terms.special_offer, terms.emi_offer, terms.replacement_policy].filter(Boolean).join(" · ")}</p>}
                          </div>
                        </div>;
                      })}
                    </div>
                  </section>
                  <section className="rounded-2xl bg-[#0b1c30] p-4 text-white">
                    <div className="flex justify-between text-[12px] text-white/75"><span>Subtotal</span><span>₹{subtotal.toLocaleString("en-IN")}</span></div>
                    {couponDiscount > 0 && <div className="mt-2 flex justify-between text-[12px] font-semibold text-[#85f8c4]"><span>Coupon {couponCode}</span><span>−₹{couponDiscount.toLocaleString("en-IN")}</span></div>}
                    <div className="mt-2 flex justify-between border-t border-white/15 pt-2 text-[14px] font-extrabold"><span>Payable total</span><span>₹{payableTotal.toLocaleString("en-IN")}</span></div>
                  </section>
                  <p className="text-[10px] leading-relaxed text-[#64748b]">Check the products, selected options, quantity, and address above. You can edit the bag or delivery address before continuing.</p>
                </div>
              )}

              {/* STEP 4: PAYMENT */}
              {checkoutStep === "payment" && (
                <div className="space-y-3">
                  <section className="rounded-2xl border border-[#dce9ff] bg-[#f8f9ff] p-3.5">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[12px] font-bold text-[#0b1c30]">Coupon code</span>{couponCode && <button type="button" onClick={() => { setCouponCode(""); setCouponDraft(""); }} className="text-[10px] font-bold text-[#b42318]">Remove</button>}</div>
                    <div className="flex gap-2"><input value={couponDraft} onChange={(event) => setCouponDraft(event.target.value.toUpperCase())} placeholder="Enter coupon" className="min-w-0 flex-1 rounded-xl border border-[#dce9ff] bg-white px-3 py-2 text-[12px] uppercase outline-none focus:border-[#006948]" /><button type="button" onClick={applyCoupon} className="rounded-xl bg-[#006948] px-4 py-2 text-[11px] font-bold text-white">Apply</button></div>
                    <div className="mt-2 flex flex-wrap gap-1.5">{[...new Map(cart.map((item) => products.find((product) => product.id === item.id)?.admin_terms).filter((terms) => terms?.coupon_code && Number(terms.coupon_percent) > 0).map((terms) => [terms.coupon_code, terms])).values()].map((terms) => <button type="button" key={terms.coupon_code} onClick={() => { setCouponDraft(terms.coupon_code); setCouponCode(terms.coupon_code); }} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-[#006948] ring-1 ring-[#cce5d6]">{terms.coupon_code} · {terms.coupon_percent}% off</button>)}</div>
                    {couponCode && <p className="mt-2 text-[10px] font-semibold text-[#08724f]">{couponCode} applied · save ₹{couponDiscount.toLocaleString("en-IN")}</p>}
                  </section>
                  <section className="rounded-2xl border border-[#dce9ff] bg-white p-3.5">
                    <div className="flex items-center justify-between gap-3"><div><p className="text-[12px] font-bold text-[#0b1c30]">Order review</p><p className="mt-0.5 text-[10px] text-[#64748b]">{cartCount} item(s) · {shippingAddress}</p></div><button type="button" onClick={() => setCheckoutStep("review")} className="shrink-0 rounded-full bg-[#eff4ff] px-3 py-1.5 text-[10px] font-bold text-[#006948]">Review / edit</button></div>
                  </section>
                  {cart.some((item) => products.find((product) => product.id === item.id)?.admin_terms?.emi_offer) && <p className="rounded-xl bg-[#f0faf4] p-3 text-[10px] leading-relaxed text-[#315643]">EMI details and eligible banks or plans are confirmed inside Razorpay Checkout. Availability depends on the payment method and customer eligibility.</p>}
                  <p className="rounded-xl bg-[#fff9e9] p-3 text-[10px] leading-relaxed text-[#68521e]">After payment, a product or size change may require cancelling the order and placing it again. Review your bag and address before paying.</p>
                  {[
                    {
                      id: "RAZORPAY",
                      icon: "credit_card",
                      title: "Pay online with Razorpay",
                      desc: "UPI, cards, netbanking, EMI and other methods enabled for your account. Final eligibility is shown by Razorpay.",
                    },
                    {
                      id: "COD",
                      icon: "payments",
                      title: "Cash on Delivery",
                      desc: "Pay upon doorstep OTP handover",
                    },
                  ].map((pm) => {
                    const selected = paymentMethod === pm.id;
                    return (
                      <div
                        key={pm.id}
                        onClick={() => setPaymentMethod(pm.id)}
                        className={`p-4 rounded-2xl cursor-pointer transition-all border-2 ${
                          selected
                            ? "border-[#006948] bg-[#eff4ff]"
                            : "border-[#e5eeff] bg-white hover:bg-[#f8f9ff]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center ${
                              selected
                                ? "bg-[#006948] text-white"
                                : "bg-[#eff4ff] text-[#3d4a42]"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[20px]">
                              {pm.icon}
                            </span>
                          </div>
                          <div className="flex-1">
                            <div className="text-[13.5px] font-bold text-[#0b1c30]">{pm.title}</div>
                            <div className="text-[11.5px] text-[#5c647a]">{pm.desc}</div>
                          </div>
                        </div>

                      </div>
                    );
                  })}

                  <div className="mt-4 p-4 rounded-2xl bg-[#0b1c30] text-white flex items-center justify-between">
                    <span className="text-[13px] text-white/80">Total Amount</span>
                    <span className="text-[20px] font-extrabold text-[#85f8c4]">
                      ₹{payableTotal.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>
              )}

              {/* STEP 4: SUCCESS */}
              {checkoutStep === "success" && lastCreatedOrder && (
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-[#85f8c4] text-[#002114] flex items-center justify-center mx-auto">
                    <span className="material-symbols-outlined text-[34px]">check_circle</span>
                  </div>
                  <h3 className="text-[22px] font-extrabold text-[#0b1c30]">
                    Order {lastCreatedOrder.order_number} Confirmed!
                  </h3>
                  <p className="text-[13px] text-[#5c647a]">
                    Saved and queued for delivery dispatch.
                  </p>

                  {lastCreatedOrder.delivery_otp && (
                    <div className="p-5 rounded-3xl bg-[#eff4ff] border border-[#bccac0]">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#3d4a42] block">
                        4-Digit Doorstep Handover PIN
                      </span>
                      <span className="text-[32px] font-black tracking-[0.25em] text-[#006948] block mt-1">
                        {lastCreatedOrder.delivery_otp}
                      </span>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setCartOpen(false);
                      setActiveView("orders");
                    }}
                    className="w-full py-3.5 rounded-full bg-[#006948] text-white font-bold text-[14px]"
                  >
                    View Live Order
                  </button>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            {cart.length > 0 && checkoutStep !== "success" && (
              <div className="px-6 py-4 border-t border-[#eff4ff] bg-white flex items-center gap-3">
                {checkoutStep !== "cart" && (
                  <button
                    onClick={() =>
                      setCheckoutStep(checkoutStep === "payment" ? "review" : checkoutStep === "review" ? "address" : "cart")
                    }
                    className="px-5 py-3 rounded-full bg-[#eff4ff] text-[#0b1c30] text-[13px] font-bold"
                  >
                    Back
                  </button>
                )}

                {checkoutStep === "cart" && (
                  <button
                    onClick={() => setCheckoutStep("address")}
                    className="flex-1 py-3.5 rounded-full bg-[#006948] hover:bg-[#00855d] text-white font-bold text-[14px]"
                  >
                    Proceed to Address • ₹{payableTotal.toLocaleString("en-IN")}
                  </button>
                )}

                {checkoutStep === "address" && (
                  <button
                    onClick={() => {
                      if (shippingAddress.trim().length < 10) {
                        notify("Enter a complete delivery address first.");
                        return;
                      }
                      setCheckoutStep("review");
                    }}
                    className="flex-1 py-3.5 rounded-full bg-[#006948] hover:bg-[#00855d] text-white font-bold text-[14px]"
                  >
                    Review Order
                  </button>
                )}

                {checkoutStep === "review" && (
                  <button onClick={() => setCheckoutStep("payment")} className="flex-1 py-3.5 rounded-full bg-[#006948] hover:bg-[#00855d] text-white font-bold text-[14px]">Confirm details • Continue to payment</button>
                )}

                {checkoutStep === "payment" && (
                  <button
                    disabled={placingOrder}
                    onClick={handlePlaceOrder}
                    className="flex-1 py-3.5 rounded-full bg-[#006948] hover:bg-[#00855d] text-white font-bold text-[14px]"
                  >
                    {placingOrder
                      ? "Processing..."
                      : paymentMethod === "COD" ? `Place order • ₹${payableTotal.toLocaleString("en-IN")}` : `Review & pay • ₹${payableTotal.toLocaleString("en-IN")}`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
