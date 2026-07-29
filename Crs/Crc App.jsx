import { useState, useEffect, useMemo } from "react";
import {
  Plus, X, Search, Shirt, CheckCircle2, PackageCheck, Phone,
  Bell, Printer, Users, TrendingUp, ClipboardList, ChevronRight, ArrowLeft,
  Trash2, CalendarDays, Clock3, Receipt, Wallet, Settings, QrCode,
} from "lucide-react";
import { supabase } from "./supabaseClient";

const DEFAULT_CAPACITY = 10;

// --- Conversion entre les objets JS (camelCase) et les lignes Supabase (snake_case) ---
function rowToOrder(r) {
  return {
    id: r.id,
    client: r.client,
    phone: r.phone,
    itemsList: r.items_list || [],
    items: r.items,
    price: r.price,
    depositDate: r.deposit_date,
    dueDate: r.due_date,
    status: r.status,
    completedDate: r.completed_date,
    amountPaid: r.amount_paid,
    paymentMethod: r.payment_method,
    paymentDate: r.payment_date,
    labelNumber: r.label_number,
  };
}
function orderToRow(o) {
  return {
    client: o.client,
    phone: o.phone,
    items_list: o.itemsList,
    items: o.items,
    price: o.price,
    deposit_date: o.depositDate,
    due_date: o.dueDate,
    status: o.status,
    completed_date: o.completedDate,
    amount_paid: o.amountPaid,
    payment_method: o.paymentMethod,
    payment_date: o.paymentDate,
  };
}
function rowToAppt(r) {
  return { id: r.id, client: r.client, phone: r.phone, date: r.date, time: r.time, type: r.type };
}
function apptToRow(a) {
  return { client: a.client, phone: a.phone, date: a.date, time: a.time, type: a.type };
}

const STATUSES = [
  { key: "depose", label: "Déposé", color: "#5B7BA8", bg: "#1A2A3E" },
  { key: "encours", label: "En cours", color: "#D9A441", bg: "#3A2E14" },
  { key: "pret", label: "Prêt", color: "#4FAE7A", bg: "#173A28" },
  { key: "recupere", label: "Récupéré", color: "#7C8896", bg: "#22262C" },
];

const PAYMENT_METHODS = ["Espèces", "Mixx by Yas", "Flooz", "Virement", "Autre"];
const PAYMENT_STATUSES = [
  { key: "payee", label: "Payée", color: "#4FAE7A", bg: "#173A28" },
  { key: "partielle", label: "Partielle", color: "#D9A441", bg: "#3A2E14" },
  { key: "impayee", label: "Impayée", color: "#D9634A", bg: "#3A1616" },
];
function paymentStatus(order) {
  const price = order.price || 0;
  const paid = order.amountPaid || 0;
  if (price <= 0) return null;
  if (paid >= price) return "payee";
  if (paid > 0) return "partielle";
  return "impayee";
}
function paymentStatusOf(key) {
  return PAYMENT_STATUSES.find(s => s.key === key);
}

const GARMENT_TYPES = [
  "Chemise", "Chemise enfant", "T-shirt", "Polo", "Pantalon", "Jogging",
  "Pull-over", "Robe", "Robe bazin", "Robe pagne trois pièces", "Abaya",
  "Complet tissu", "Complet bazin", "Complet lin", "Veste/Costume",
  "Culotte", "Culotte enfant", "Sous-vêtement", "Débardeur", "Chaussette",
  "Chapeau", "Draps", "Taie", "Couverture", "Autre",
];

function statusOf(key) {
  return STATUSES.find(s => s.key === key) || STATUSES[0];
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}
function fmtDateLong(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
}
function isOverdue(order) {
  if (order.status === "recupere" || !order.dueDate) return false;
  return new Date(order.dueDate) < new Date(new Date().toDateString());
}
function isDueToday(order) {
  if (order.status === "recupere" || !order.dueDate) return false;
  const today = new Date().toDateString();
  return new Date(order.dueDate).toDateString() === today;
}
function dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}
function monthKey(iso) {
  return new Date(iso).toISOString().slice(0, 7);
}
function money(n) {
  return `${(n || 0).toLocaleString("fr-FR")} F`;
}
function ticketNumber(order) {
  return "T" + order.id.slice(-6);
}
function labelCode(order) {
  if (!order.labelNumber) return "—";
  return "#" + String(order.labelNumber).padStart(4, "0");
}
function totalGarments(order) {
  if (order.itemsList && order.itemsList.length) {
    return order.itemsList.reduce((sum, r) => sum + (r.qty || 0), 0);
  }
  return 1;
}
function qrCodeUrl(order) {
  const data = [
    `Ticket ${ticketNumber(order)}`,
    `Client: ${order.client}`,
    order.phone ? `Tel: ${order.phone}` : null,
    `Articles: ${order.items}`,
    `Montant: ${money(order.price)}`,
    order.dueDate ? `Retrait prevu: ${fmtDate(order.dueDate)}` : null,
  ].filter(Boolean).join(" | ");
  return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=6&data=${encodeURIComponent(data)}`;
}
function summarizeItems(rows) {
  return rows.filter(r => r.qty > 0).map(r => `${r.qty} ${r.type}`).join(", ");
}

export default function App() {
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("tous");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("commandes");
  const [showNotifs, setShowNotifs] = useState(false);
  const [printOrderId, setPrintOrderId] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [itemRows, setItemRows] = useState([{ type: GARMENT_TYPES[0], qty: 1 }]);
  const [price, setPrice] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");

  // Rendez-vous
  const [appointments, setAppointments] = useState([]);
  const [apptLoaded, setApptLoaded] = useState(false);
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const [showApptForm, setShowApptForm] = useState(false);
  const [apptClient, setApptClient] = useState("");
  const [apptPhone, setApptPhone] = useState("");
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("");
  const [apptType, setApptType] = useState("depot");
  const [apptError, setApptError] = useState("");

  // Factures / paiements
  const [invoiceFilter, setInvoiceFilter] = useState("tous");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentOrderId, setPaymentOrderId] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [paymentError, setPaymentError] = useState("");

  // Tarifs par article
  const [unitPrices, setUnitPrices] = useState({});
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const [showPricesForm, setShowPricesForm] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from("orders").select("*").order("deposit_date", { ascending: false });
        if (error) throw error;
        setOrders((data || []).map(rowToOrder));
      } catch (e) { console.error("Échec du chargement des commandes", e); }
      finally { setLoaded(true); }
    })();
    (async () => {
      try {
        const { data, error } = await supabase.from("appointments").select("*").order("date", { ascending: true });
        if (error) throw error;
        setAppointments((data || []).map(rowToAppt));
      } catch (e) { console.error("Échec du chargement des rendez-vous", e); }
      finally { setApptLoaded(true); }
    })();
    (async () => {
      try {
        const { data, error } = await supabase.from("settings").select("*").eq("key", "capacity").maybeSingle();
        if (error) throw error;
        if (data && data.value && data.value.n) setCapacity(data.value.n);
      } catch (e) { /* valeur par défaut */ }
    })();
    (async () => {
      try {
        const { data, error } = await supabase.from("settings").select("*").eq("key", "prices").maybeSingle();
        if (error) throw error;
        if (data && data.value) setUnitPrices(data.value);
      } catch (e) { /* aucun tarif défini encore */ }
      finally { setPricesLoaded(true); }
    })();
  }, []);

  useEffect(() => {
    if (!printOrderId) return;
    const t = setTimeout(() => window.print(), 150);
    const onAfterPrint = () => setPrintOrderId(null);
    window.addEventListener("afterprint", onAfterPrint);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", onAfterPrint); };
  }, [printOrderId]);

  const persistCapacity = async (val) => {
    setCapacity(val);
    try { await supabase.from("settings").upsert({ key: "capacity", value: { n: val } }); }
    catch (e) { console.error("Échec de la sauvegarde", e); }
  };
  const updateUnitPrice = async (type, val) => {
    const next = { ...unitPrices, [type]: val };
    setUnitPrices(next);
    try { await supabase.from("settings").upsert({ key: "prices", value: next }); }
    catch (e) { console.error("Échec de la sauvegarde", e); }
  };

  const addItemRow = () => setItemRows(r => [...r, { type: GARMENT_TYPES[0], qty: 1 }]);
  const removeItemRow = (i) => setItemRows(r => r.filter((_, idx) => idx !== i));
  const updateItemRow = (i, field, val) => setItemRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const addOrder = async () => {
    if (!client.trim()) { setError("Le nom du client est requis."); return; }
    const validRows = itemRows.filter(r => r.qty > 0);
    if (validRows.length === 0) { setError("Merci d'ajouter au moins un article."); return; }
    const p = price ? parseFloat(price) : 0;
    const newOrder = {
      client: client.trim(),
      phone: phone.trim(),
      itemsList: validRows,
      items: summarizeItems(validRows),
      price: p,
      depositDate: new Date().toISOString(),
      dueDate: dueDate || null,
      status: "depose",
      completedDate: null,
      amountPaid: 0,
      paymentMethod: null,
      paymentDate: null,
    };
    try {
      const { data, error } = await supabase.from("orders").insert(orderToRow(newOrder)).select().single();
      if (error) throw error;
      const saved = rowToOrder(data);
      setOrders([saved, ...orders]);
      setClient(""); setPhone(""); setItemRows([{ type: GARMENT_TYPES[0], qty: 1 }]); setPrice(""); setDueDate(""); setError("");
      setShowForm(false);
      setPrintOrderId(saved.id);
    } catch (e) {
      console.error("Échec de l'enregistrement", e);
      setError("Échec de l'enregistrement — vérifie ta connexion internet et réessaie.");
    }
  };

  const advanceStatus = async (id) => {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const idx = STATUSES.findIndex(s => s.key === order.status);
    const next = STATUSES[Math.min(idx + 1, STATUSES.length - 1)].key;
    const completedDate = next === "recupere" ? new Date().toISOString() : order.completedDate;
    setOrders(orders.map(o => o.id === id ? { ...o, status: next, completedDate } : o));
    try {
      await supabase.from("orders").update({ status: next, completed_date: completedDate }).eq("id", id);
    } catch (e) { console.error("Échec de la mise à jour", e); }
  };

  const addAppointment = async () => {
    if (!apptClient.trim()) { setApptError("Le nom du client est requis."); return; }
    if (!apptDate) { setApptError("Merci de choisir une date."); return; }
    const newAppt = { client: apptClient.trim(), phone: apptPhone.trim(), date: apptDate, time: apptTime || null, type: apptType };
    try {
      const { data, error } = await supabase.from("appointments").insert(apptToRow(newAppt)).select().single();
      if (error) throw error;
      const saved = rowToAppt(data);
      setAppointments([...appointments, saved].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))));
      setApptClient(""); setApptPhone(""); setApptDate(""); setApptTime(""); setApptType("depot"); setApptError("");
      setShowApptForm(false);
    } catch (e) {
      console.error("Échec de l'enregistrement", e);
      setApptError("Échec de l'enregistrement — vérifie ta connexion internet et réessaie.");
    }
  };
  const removeAppointment = async (id) => {
    setAppointments(appointments.filter(a => a.id !== id));
    try { await supabase.from("appointments").delete().eq("id", id); }
    catch (e) { console.error("Échec de la suppression", e); }
  };

  const openPaymentModal = (order) => {
    setPaymentOrderId(order.id);
    setPaymentAmount(order.amountPaid ? String(order.amountPaid) : "");
    setPaymentMethod(order.paymentMethod || PAYMENT_METHODS[0]);
    setPaymentError("");
    setShowPaymentForm(true);
  };

  const recordPayment = async (orderId, amount, method) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const clamped = Math.max(0, Math.min(amount, order.price || 0));
    const paymentDate = new Date().toISOString();
    setOrders(orders.map(o => o.id === orderId ? { ...o, amountPaid: clamped, paymentMethod: method, paymentDate } : o));
    try {
      await supabase.from("orders").update({ amount_paid: clamped, payment_method: method, payment_date: paymentDate }).eq("id", orderId);
    } catch (e) { console.error("Échec de la mise à jour du paiement", e); }
  };

  const submitPayment = () => {
    const order = orders.find(o => o.id === paymentOrderId);
    if (!order) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount < 0) { setPaymentError("Merci d'indiquer un montant valide."); return; }
    if (order.price && amount > order.price) { setPaymentError("Le montant dépasse le prix de la commande."); return; }
    recordPayment(order.id, amount, paymentMethod);
    setShowPaymentForm(false); setPaymentOrderId(null); setPaymentAmount(""); setPaymentError("");
  };

  const markFullyPaid = (order) => recordPayment(order.id, order.price || 0, order.paymentMethod || PAYMENT_METHODS[0]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (filter !== "tous" && o.status !== filter) return false;
      if (query) {
        const q = query.toLowerCase().replace(/^#/, "");
        const haystack = `${o.client} ${o.items} ${o.labelNumber || ""} ${labelCode(o)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [orders, filter, query]);

  const counts = useMemo(() => {
    const c = { depose: 0, encours: 0, pret: 0, recupere: 0 };
    orders.forEach(o => { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }, [orders]);

  const revenue = useMemo(() => orders.filter(o => o.status === "recupere").reduce((a, o) => a + (o.price || 0), 0), [orders]);

  const overdueOrders = useMemo(() => orders.filter(isOverdue), [orders]);
  const dueTodayOrders = useMemo(() => orders.filter(isDueToday), [orders]);
  const readyOrders = useMemo(() => orders.filter(o => o.status === "pret"), [orders]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const apptsToday = useMemo(() => appointments.filter(a => a.date === todayStr), [appointments, todayStr]);
  const notifCount = overdueOrders.length + dueTodayOrders.length + readyOrders.length;

  const clients = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      const key = o.client.trim().toLowerCase();
      if (!map[key]) map[key] = { name: o.client.trim(), phone: o.phone, orders: [] };
      map[key].orders.push(o);
      if (o.phone) map[key].phone = o.phone;
    });
    return Object.values(map)
      .map(c => ({
        ...c,
        total: c.orders.reduce((a, o) => a + (o.price || 0), 0),
        lastVisit: c.orders.reduce((max, o) => o.depositDate > max ? o.depositDate : max, c.orders[0].depositDate),
      }))
      .sort((a, b) => b.lastVisit.localeCompare(a.lastVisit));
  }, [orders]);

  const clientFiltered = useMemo(() => {
    if (!query) return clients;
    return clients.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
  }, [clients, query]);

  const thisMonthKeyV = monthKey(new Date().toISOString());
  const completed = useMemo(() => orders.filter(o => o.status === "recupere"), [orders]);

  const revenueToday = useMemo(() =>
    completed.filter(o => dayKey(o.completedDate || o.depositDate) === todayStr).reduce((a, o) => a + (o.price || 0), 0),
  [completed, todayStr]);

  const revenueThisMonth = useMemo(() =>
    completed.filter(o => monthKey(o.completedDate || o.depositDate) === thisMonthKeyV).reduce((a, o) => a + (o.price || 0), 0),
  [completed, thisMonthKeyV]);

  const last14Days = useMemo(() => {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKey(d.toISOString());
      const total = completed.filter(o => dayKey(o.completedDate || o.depositDate) === key).reduce((a, o) => a + (o.price || 0), 0);
      days.push({ key, label: fmtDateShort(d.toISOString()), total });
    }
    return days;
  }, [completed]);

  const last6Months = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = monthKey(d.toISOString());
      const total = completed.filter(o => monthKey(o.completedDate || o.depositDate) === key).reduce((a, o) => a + (o.price || 0), 0);
      months.push({ key, label: d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }), total });
    }
    return months;
  }, [completed]);

  const garmentTotals = useMemo(() => {
    const totals = {};
    orders.forEach(o => {
      (o.itemsList || []).forEach(row => {
        totals[row.type] = (totals[row.type] || 0) + Number(row.qty || 0);
      });
    });
    return Object.entries(totals).map(([type, qty]) => ({ type, qty })).sort((a, b) => b.qty - a.qty);
  }, [orders]);
  const totalGarments = garmentTotals.reduce((a, g) => a + g.qty, 0);
  const maxGarment = Math.max(1, ...garmentTotals.map(g => g.qty));

  const maxDay = Math.max(1, ...last14Days.map(d => d.total));
  const maxMonth = Math.max(1, ...last6Months.map(m => m.total));

  const apptsByDate = useMemo(() => {
    const map = {};
    appointments
      .filter(a => a.date >= todayStr)
      .forEach(a => { (map[a.date] = map[a.date] || []).push(a); });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [appointments, todayStr]);

  const apptCountForDate = (date) => appointments.filter(a => a.date === date).length;

  const invoicedOrders = useMemo(() => orders.filter(o => (o.price || 0) > 0), [orders]);
  const totalInvoiced = useMemo(() => invoicedOrders.reduce((a, o) => a + (o.price || 0), 0), [invoicedOrders]);
  const totalCollected = useMemo(() => invoicedOrders.reduce((a, o) => a + (o.amountPaid || 0), 0), [invoicedOrders]);
  const totalOutstanding = totalInvoiced - totalCollected;

  const filteredInvoices = useMemo(() => {
    return invoicedOrders
      .filter(o => invoiceFilter === "tous" || paymentStatus(o) === invoiceFilter)
      .filter(o => !query || o.client.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.depositDate.localeCompare(a.depositDate));
  }, [invoicedOrders, invoiceFilter, query]);

  const printOrder = orders.find(o => o.id === printOrderId);

  const suggestedTotal = useMemo(() =>
    itemRows.reduce((sum, row) => sum + (Number(unitPrices[row.type]) || 0) * (row.qty || 0), 0),
  [itemRows, unitPrices]);

  return (
    <div style={{
      minHeight: "100vh", background: "#F6F3EC", color: "#22262C",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", paddingBottom: "6rem",
    }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-ticket, .print-ticket * { visibility: visible; }
          .print-ticket { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div style={{ background: "#22262C", color: "#F6F3EC", padding: "1.5rem 1.25rem 1.75rem", borderBottom: "4px solid #4FAE7A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
              <Shirt size={20} strokeWidth={2} color="#4FAE7A" />
              <span style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#9AA4AE", fontWeight: 600 }}>
                Gestion pressing
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
              {tab === "commandes" && "Tableau de bord"}
              {tab === "rdv" && "Rendez-vous"}
              {tab === "clients" && "Clients"}
              {tab === "factures" && "Factures"}
              {tab === "recettes" && "Statistiques"}
            </h1>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => setShowPricesForm(true)}
              style={{ background: "#2E3339", border: "none", borderRadius: "10px", padding: "0.55rem", color: "#F6F3EC", cursor: "pointer" }}
              aria-label="Tarifs"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={() => setShowNotifs(v => !v)}
              style={{ position: "relative", background: "#2E3339", border: "none", borderRadius: "10px", padding: "0.55rem", color: "#F6F3EC", cursor: "pointer" }}
              aria-label="Notifications"
            >
              <Bell size={18} />
              {notifCount > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -4, background: "#D9634A", color: "#fff",
                  fontSize: "0.65rem", fontWeight: 700, borderRadius: "999px", minWidth: 16, height: 16,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                }}>{notifCount}</span>
              )}
            </button>
          </div>
        </div>

        {tab === "commandes" && (
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.1rem", overflowX: "auto" }}>
            <StatCard label="En attente" value={counts.depose + counts.encours} accent="#D9A441" />
            <StatCard label="Prêts" value={counts.pret} accent="#4FAE7A" />
            <StatCard label="Recettes totales" value={money(revenue)} accent="#5B7BA8" />
          </div>
        )}

        {showNotifs && (
          <div style={{ marginTop: "1rem", background: "#2E3339", borderRadius: "12px", padding: "0.9rem", fontSize: "0.85rem" }}>
            {notifCount === 0 && apptsToday.length === 0 ? (
              <div style={{ color: "#9AA4AE" }}>Aucune alerte pour le moment.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {overdueOrders.length > 0 && (
                  <NotifRow color="#D9634A" text={`${overdueOrders.length} commande${overdueOrders.length > 1 ? "s" : ""} en retard`} />
                )}
                {dueTodayOrders.length > 0 && (
                  <NotifRow color="#D9A441" text={`${dueTodayOrders.length} commande${dueTodayOrders.length > 1 ? "s" : ""} à retirer aujourd'hui`} />
                )}
                {readyOrders.length > 0 && (
                  <NotifRow color="#4FAE7A" text={`${readyOrders.length} commande${readyOrders.length > 1 ? "s" : ""} prête${readyOrders.length > 1 ? "s" : ""}, en attente de retrait`} />
                )}
                {apptsToday.length > 0 && (
                  <NotifRow color="#5B7BA8" text={`${apptsToday.length} rendez-vous prévu${apptsToday.length > 1 ? "s" : ""} aujourd'hui`} />
                )}
                <div style={{ fontSize: "0.72rem", color: "#7C8896", marginTop: "0.2rem" }}>
                  Ces alertes s'affichent dans l'appli — consulte cet écran régulièrement pour suivre les retards, les commandes prêtes et les rendez-vous.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {tab === "commandes" && (
        <div style={{ padding: "1.1rem 1.1rem 0" }}>
          <div style={{ position: "relative", marginBottom: "0.85rem" }}>
            <Search size={16} color="#9AA4AE" style={{ position: "absolute", left: "0.8rem", top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un client ou un article…"
              style={{
                width: "100%", padding: "0.65rem 0.8rem 0.65rem 2.3rem", borderRadius: "10px",
                border: "1px solid #DDD6C6", background: "#FFFDF8", fontSize: "0.9rem",
                boxSizing: "border-box", color: "#22262C",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", marginBottom: "1rem", paddingBottom: "0.2rem" }}>
            <FilterChip label="Tous" active={filter === "tous"} onClick={() => setFilter("tous")} />
            {STATUSES.map(s => (
              <FilterChip key={s.key} label={s.label} active={filter === s.key} onClick={() => setFilter(s.key)} color={s.color} />
            ))}
          </div>

          {!loaded ? (
            <div style={{ color: "#9AA4AE", fontSize: "0.9rem", padding: "1rem 0" }}>Chargement…</div>
          ) : filtered.length === 0 ? (
            <div style={{ border: "1.5px dashed #DDD6C6", borderRadius: "14px", padding: "2rem 1rem", textAlign: "center", color: "#9AA4AE", fontSize: "0.9rem" }}>
              {orders.length === 0 ? "Aucune commande. Appuyez sur « + » pour en ajouter une." : "Aucun résultat pour ce filtre."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {filtered.map(order => (
                <OrderCard key={order.id} order={order} onAdvance={() => advanceStatus(order.id)} onPrint={() => setPrintOrderId(order.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "rdv" && (
        <div style={{ padding: "1.1rem" }}>
          <div style={{ background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.85rem 1rem", marginBottom: "1.1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Capacité par jour</div>
              <div style={{ fontSize: "0.75rem", color: "#8A8373" }}>Nombre max. de rendez-vous / jour</div>
            </div>
            <input
              type="number"
              value={capacity}
              onChange={(e) => persistCapacity(parseInt(e.target.value, 10) || 1)}
              style={{ width: "64px", textAlign: "center", padding: "0.4rem", borderRadius: "8px", border: "1px solid #DDD6C6", fontSize: "0.95rem", fontWeight: 700 }}
            />
          </div>

          {!apptLoaded ? (
            <div style={{ color: "#9AA4AE", fontSize: "0.9rem" }}>Chargement…</div>
          ) : apptsByDate.length === 0 ? (
            <div style={{ border: "1.5px dashed #DDD6C6", borderRadius: "14px", padding: "2rem 1rem", textAlign: "center", color: "#9AA4AE", fontSize: "0.9rem" }}>
              Aucun rendez-vous à venir. Appuyez sur « + » pour en planifier un.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              {apptsByDate.map(([date, appts]) => {
                const full = appts.length >= capacity;
                return (
                  <div key={date}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <div style={{ fontSize: "0.82rem", fontWeight: 700, textTransform: "capitalize" }}>{fmtDateLong(date)}</div>
                      <span style={{ fontSize: "0.72rem", fontWeight: 700, color: full ? "#D9634A" : "#4FAE7A" }}>
                        {appts.length}/{capacity} {full ? "· complet" : "places"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {appts.map(a => (
                        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "12px", padding: "0.7rem 0.9rem" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{a.client}</span>
                              <span style={{
                                fontSize: "0.68rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "999px",
                                background: a.type === "depot" ? "#1A2A3E" : "#173A28",
                                color: a.type === "depot" ? "#5B7BA8" : "#4FAE7A",
                              }}>
                                {a.type === "depot" ? "Dépôt" : "Retrait"}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#8A8373", marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                              {a.time && <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}><Clock3 size={11} />{a.time}</span>}
                              {a.phone && <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}><Phone size={11} />{a.phone}</span>}
                            </div>
                          </div>
                          <button onClick={() => removeAppointment(a.id)} style={{ background: "none", border: "none", color: "#9AA4AE", cursor: "pointer" }} aria-label="Supprimer">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "clients" && (
        <div style={{ padding: "1.1rem" }}>
          {!selectedClient ? (
            <>
              <div style={{ position: "relative", marginBottom: "1rem" }}>
                <Search size={16} color="#9AA4AE" style={{ position: "absolute", left: "0.8rem", top: "50%", transform: "translateY(-50%)" }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un client…"
                  style={{
                    width: "100%", padding: "0.65rem 0.8rem 0.65rem 2.3rem", borderRadius: "10px",
                    border: "1px solid #DDD6C6", background: "#FFFDF8", fontSize: "0.9rem",
                    boxSizing: "border-box", color: "#22262C",
                  }}
                />
              </div>
              {clientFiltered.length === 0 ? (
                <div style={{ border: "1.5px dashed #DDD6C6", borderRadius: "14px", padding: "2rem 1rem", textAlign: "center", color: "#9AA4AE", fontSize: "0.9rem" }}>
                  Aucun client trouvé.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {clientFiltered.map(c => (
                    <button key={c.name} onClick={() => setSelectedClient(c.name)} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px",
                      padding: "0.85rem 1rem", cursor: "pointer", textAlign: "left", width: "100%",
                    }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{c.name}</div>
                        <div style={{ fontSize: "0.78rem", color: "#8A8373", marginTop: "0.15rem" }}>
                          {c.orders.length} commande{c.orders.length > 1 ? "s" : ""} · {money(c.total)}
                        </div>
                      </div>
                      <ChevronRight size={18} color="#9AA4AE" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <ClientHistory
              client={clients.find(c => c.name === selectedClient)}
              onBack={() => setSelectedClient(null)}
              onAdvance={advanceStatus}
              onPrint={setPrintOrderId}
            />
          )}
        </div>
      )}

      {tab === "factures" && (
        <div style={{ padding: "1.1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", overflowX: "auto" }}>
            <div style={{ flex: 1, minWidth: "104px", background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.8rem" }}>
              <div style={{ fontSize: "0.66rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.05em" }}>Facturé</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.15rem" }}>{money(totalInvoiced)}</div>
            </div>
            <div style={{ flex: 1, minWidth: "104px", background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.8rem", borderTop: "3px solid #4FAE7A" }}>
              <div style={{ fontSize: "0.66rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.05em" }}>Encaissé</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.15rem" }}>{money(totalCollected)}</div>
            </div>
            <div style={{ flex: 1, minWidth: "104px", background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.8rem", borderTop: "3px solid #D9634A" }}>
              <div style={{ fontSize: "0.66rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.05em" }}>Reste à percevoir</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.15rem" }}>{money(totalOutstanding)}</div>
            </div>
          </div>

          <div style={{ position: "relative", marginBottom: "0.85rem" }}>
            <Search size={16} color="#9AA4AE" style={{ position: "absolute", left: "0.8rem", top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un client…"
              style={{
                width: "100%", padding: "0.65rem 0.8rem 0.65rem 2.3rem", borderRadius: "10px",
                border: "1px solid #DDD6C6", background: "#FFFDF8", fontSize: "0.9rem",
                boxSizing: "border-box", color: "#22262C",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", marginBottom: "1rem", paddingBottom: "0.2rem" }}>
            <FilterChip label="Toutes" active={invoiceFilter === "tous"} onClick={() => setInvoiceFilter("tous")} />
            {PAYMENT_STATUSES.map(s => (
              <FilterChip key={s.key} label={s.label} active={invoiceFilter === s.key} onClick={() => setInvoiceFilter(s.key)} color={s.color} />
            ))}
          </div>

          {filteredInvoices.length === 0 ? (
            <div style={{ border: "1.5px dashed #DDD6C6", borderRadius: "14px", padding: "2rem 1rem", textAlign: "center", color: "#9AA4AE", fontSize: "0.9rem" }}>
              {invoicedOrders.length === 0 ? "Aucune commande facturée pour le moment." : "Aucun résultat pour ce filtre."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {filteredInvoices.map(order => {
                const pst = paymentStatusOf(paymentStatus(order));
                const remaining = (order.price || 0) - (order.amountPaid || 0);
                return (
                  <div key={order.id} style={{ background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.9rem 1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "1rem" }}>{order.client}</div>
                        <div style={{ fontSize: "0.75rem", color: "#8A8373", marginTop: "0.15rem" }}>
                          {ticketNumber(order)} · {fmtDate(order.depositDate)}
                        </div>
                      </div>
                      {pst && (
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "0.25rem 0.6rem", borderRadius: "999px", background: pst.bg, color: pst.color }}>
                          {pst.label}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "1.1rem", marginTop: "0.65rem" }}>
                      <div>
                        <div style={{ fontSize: "0.66rem", color: "#8A8373", textTransform: "uppercase" }}>Prix</div>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{money(order.price)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.66rem", color: "#8A8373", textTransform: "uppercase" }}>Payé</div>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{money(order.amountPaid || 0)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.66rem", color: "#8A8373", textTransform: "uppercase" }}>Reste</div>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: remaining > 0 ? "#D9634A" : "#22262C" }}>{money(remaining)}</div>
                      </div>
                    </div>
                    {order.paymentMethod && (
                      <div style={{ fontSize: "0.72rem", color: "#8A8373", marginTop: "0.4rem" }}>
                        Réglé par {order.paymentMethod}{order.paymentDate ? ` le ${fmtDate(order.paymentDate)}` : ""}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                      <button onClick={() => openPaymentModal(order)} style={{
                        flex: 1, padding: "0.55rem", background: "#F6F3EC", color: "#22262C", border: "1px solid #DDD6C6",
                        borderRadius: "9px", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                      }}>
                        Enregistrer un paiement
                      </button>
                      {remaining > 0 && (
                        <button onClick={() => markFullyPaid(order)} style={{
                          flex: 1, padding: "0.55rem", background: "#4FAE7A", color: "#FFFDF8", border: "none",
                          borderRadius: "9px", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                        }}>
                          Payer en totalité
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "recettes" && (
        <div style={{ padding: "1.1rem" }}>
          <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.2rem" }}>
            <div style={{ flex: 1, background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.9rem" }}>
              <div style={{ fontSize: "0.7rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.06em" }}>Aujourd'hui</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, marginTop: "0.2rem" }}>{money(revenueToday)}</div>
            </div>
            <div style={{ flex: 1, background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.9rem" }}>
              <div style={{ fontSize: "0.7rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.06em" }}>Ce mois-ci</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, marginTop: "0.2rem" }}>{money(revenueThisMonth)}</div>
            </div>
          </div>

          <div style={{ fontSize: "0.72rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.6rem" }}>
            14 derniers jours
          </div>
          <div style={{ background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "1rem", marginBottom: "1.3rem" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "0.35rem", height: "110px" }}>
              {last14Days.map(d => (
                <div key={d.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                  <div title={money(d.total)} style={{
                    width: "100%", background: d.total > 0 ? "#4FAE7A" : "#EDE7D8", borderRadius: "3px 3px 0 0",
                    height: `${Math.max(3, (d.total / maxDay) * 90)}px`,
                  }} />
                  <div style={{ fontSize: "0.6rem", color: "#9AA4AE", marginTop: "0.3rem", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                    {d.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: "0.72rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.6rem" }}>
            Par mois
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.3rem" }}>
            {last6Months.map(m => (
              <div key={m.key} style={{ display: "flex", alignItems: "center", gap: "0.7rem", background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "10px", padding: "0.6rem 0.85rem" }}>
                <div style={{ fontSize: "0.82rem", width: "88px", flexShrink: 0, textTransform: "capitalize" }}>{m.label}</div>
                <div style={{ flex: 1, background: "#EDE7D8", borderRadius: "5px", overflow: "hidden", height: "8px" }}>
                  <div style={{ width: `${(m.total / maxMonth) * 100}%`, background: "#5B7BA8", height: "100%" }} />
                </div>
                <div style={{ fontSize: "0.82rem", fontWeight: 700, width: "76px", textAlign: "right", flexShrink: 0 }}>{money(m.total)}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
            <div style={{ fontSize: "0.72rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Linge reçu par type
            </div>
            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>{totalGarments} article{totalGarments > 1 ? "s" : ""} au total</div>
          </div>
          {garmentTotals.length === 0 ? (
            <div style={{ border: "1.5px dashed #DDD6C6", borderRadius: "14px", padding: "1.5rem 1rem", textAlign: "center", color: "#9AA4AE", fontSize: "0.85rem" }}>
              Aucun article enregistré pour le moment.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {garmentTotals.map(g => (
                <div key={g.type} style={{ display: "flex", alignItems: "center", gap: "0.7rem", background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "10px", padding: "0.6rem 0.85rem" }}>
                  <div style={{ fontSize: "0.82rem", width: "110px", flexShrink: 0 }}>{g.type}</div>
                  <div style={{ flex: 1, background: "#EDE7D8", borderRadius: "5px", overflow: "hidden", height: "8px" }}>
                    <div style={{ width: `${(g.qty / maxGarment) * 100}%`, background: "#D9A441", height: "100%" }} />
                  </div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 700, width: "40px", textAlign: "right", flexShrink: 0 }}>{g.qty}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, background: "#FFFDF8",
        borderTop: "1px solid #E8E1D2", display: "flex", padding: "0.5rem 0.3rem calc(0.5rem + env(safe-area-inset-bottom))",
      }}>
        <TabButton icon={ClipboardList} label="Commandes" active={tab === "commandes"} onClick={() => { setTab("commandes"); setQuery(""); }} />
        <TabButton icon={CalendarDays} label="Rendez-vous" active={tab === "rdv"} onClick={() => setTab("rdv")} />
        <TabButton icon={Users} label="Clients" active={tab === "clients"} onClick={() => { setTab("clients"); setQuery(""); setSelectedClient(null); }} />
        <TabButton icon={Receipt} label="Factures" active={tab === "factures"} onClick={() => { setTab("factures"); setQuery(""); }} />
        <TabButton icon={TrendingUp} label="Stats" active={tab === "recettes"} onClick={() => setTab("recettes")} />
      </div>

      {tab === "commandes" && (
        <button
          onClick={() => setShowForm(true)}
          style={{
            position: "fixed", bottom: "5rem", right: "1.5rem",
            width: "56px", height: "56px", borderRadius: "50%",
            background: "#4FAE7A", border: "none", color: "#FFFDF8",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 8px 24px rgba(79,174,122,0.4)", cursor: "pointer",
          }}
          aria-label="Nouvelle commande"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      )}
      {tab === "rdv" && (
        <button
          onClick={() => setShowApptForm(true)}
          style={{
            position: "fixed", bottom: "5rem", right: "1.5rem",
            width: "56px", height: "56px", borderRadius: "50%",
            background: "#5B7BA8", border: "none", color: "#FFFDF8",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 8px 24px rgba(91,123,168,0.4)", cursor: "pointer",
          }}
          aria-label="Nouveau rendez-vous"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(34,38,44,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#FFFDF8", borderTop: "1px solid #E8E1D2", borderRadius: "20px 20px 0 0", padding: "1.25rem", width: "100%", maxWidth: "480px", maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Nouvelle commande</h2>
              <button onClick={() => { setShowForm(false); setError(""); }} style={{ background: "none", border: "none", color: "#9AA4AE", cursor: "pointer" }}>
                <X size={20} />
              </button>
            </div>
            <Field label="Nom du client" value={client} onChange={setClient} placeholder="Ex : Awa Koffi" />
            <Field label="Téléphone (optionnel)" value={phone} onChange={setPhone} placeholder="Ex : 90 12 34 56" />

            <label style={{ display: "block", fontSize: "0.72rem", color: "#8A8373", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Articles déposés
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.5rem" }}>
              {itemRows.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <select
                    value={row.type}
                    onChange={(e) => updateItemRow(i, "type", e.target.value)}
                    style={{ flex: 2, padding: "0.55rem", borderRadius: "9px", border: "1px solid #DDD6C6", background: "#F6F3EC", fontSize: "0.88rem" }}
                  >
                    {GARMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="number" min="1" value={row.qty}
                    onChange={(e) => updateItemRow(i, "qty", parseInt(e.target.value, 10) || 0)}
                    style={{ width: "64px", padding: "0.55rem", borderRadius: "9px", border: "1px solid #DDD6C6", background: "#F6F3EC", fontSize: "0.88rem", textAlign: "center" }}
                  />
                  {itemRows.length > 1 && (
                    <button onClick={() => removeItemRow(i)} style={{ background: "none", border: "none", color: "#9AA4AE", cursor: "pointer", padding: "0.3rem" }}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addItemRow} style={{ background: "none", border: "1px dashed #DDD6C6", borderRadius: "9px", padding: "0.5rem", width: "100%", color: "#6B6456", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", marginBottom: "0.6rem" }}>
              + Ajouter un type d'article
            </button>

            {suggestedTotal > 0 && (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: "#F6F3EC", border: "1px solid #E8E1D2", borderRadius: "10px",
                padding: "0.6rem 0.8rem", marginBottom: "0.9rem",
              }}>
                <div style={{ fontSize: "0.82rem" }}>
                  Total suggéré (selon tarifs) : <strong>{money(suggestedTotal)}</strong>
                </div>
                <button onClick={() => setPrice(String(suggestedTotal))} style={{
                  background: "#22262C", color: "#F6F3EC", border: "none", borderRadius: "8px",
                  padding: "0.4rem 0.7rem", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
                }}>
                  Utiliser
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <Field label="Prix (F CFA)" value={price} onChange={setPrice} placeholder="2000" type="number" />
              <Field label="Date de retrait prévue" value={dueDate} onChange={setDueDate} type="date" />
            </div>
            {error && <div style={{ color: "#D9634A", fontSize: "0.82rem", marginTop: "0.3rem" }}>{error}</div>}
            <button onClick={addOrder} style={{ marginTop: "0.9rem", width: "100%", padding: "0.85rem", background: "#4FAE7A", color: "#FFFDF8", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
              Enregistrer la commande
            </button>
          </div>
        </div>
      )}

      {showApptForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(34,38,44,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#FFFDF8", borderTop: "1px solid #E8E1D2", borderRadius: "20px 20px 0 0", padding: "1.25rem", width: "100%", maxWidth: "480px", maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Nouveau rendez-vous</h2>
              <button onClick={() => { setShowApptForm(false); setApptError(""); }} style={{ background: "none", border: "none", color: "#9AA4AE", cursor: "pointer" }}>
                <X size={20} />
              </button>
            </div>
            <Field label="Nom du client" value={apptClient} onChange={setApptClient} placeholder="Ex : Kodjo Mensah" />
            <Field label="Téléphone (optionnel)" value={apptPhone} onChange={setApptPhone} placeholder="Ex : 91 22 33 44" />
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <Field label="Date" value={apptDate} onChange={setApptDate} type="date" />
              <Field label="Heure (optionnel)" value={apptTime} onChange={setApptTime} type="time" />
            </div>
            <label style={{ display: "block", fontSize: "0.72rem", color: "#8A8373", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Type</label>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <button onClick={() => setApptType("depot")} style={{
                flex: 1, padding: "0.6rem", borderRadius: "9px", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700,
                border: `1px solid ${apptType === "depot" ? "#5B7BA8" : "#DDD6C6"}`,
                background: apptType === "depot" ? "#5B7BA8" : "#F6F3EC", color: apptType === "depot" ? "#fff" : "#6B6456",
              }}>Dépôt</button>
              <button onClick={() => setApptType("retrait")} style={{
                flex: 1, padding: "0.6rem", borderRadius: "9px", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700,
                border: `1px solid ${apptType === "retrait" ? "#4FAE7A" : "#DDD6C6"}`,
                background: apptType === "retrait" ? "#4FAE7A" : "#F6F3EC", color: apptType === "retrait" ? "#fff" : "#6B6456",
              }}>Retrait</button>
            </div>
            {apptDate && (
              <div style={{
                fontSize: "0.78rem", marginBottom: "0.6rem",
                color: apptCountForDate(apptDate) >= capacity ? "#D9634A" : "#8A8373",
              }}>
                {apptCountForDate(apptDate)}/{capacity} créneaux déjà pris ce jour-là
                {apptCountForDate(apptDate) >= capacity ? " — journée complète, à confirmer avec prudence." : ""}
              </div>
            )}
            {apptError && <div style={{ color: "#D9634A", fontSize: "0.82rem", marginBottom: "0.4rem" }}>{apptError}</div>}
            <button onClick={addAppointment} style={{ width: "100%", padding: "0.85rem", background: "#5B7BA8", color: "#FFFDF8", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
              Planifier le rendez-vous
            </button>
          </div>
        </div>
      )}

      {showPricesForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(34,38,44,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#FFFDF8", borderTop: "1px solid #E8E1D2", borderRadius: "20px 20px 0 0", padding: "1.25rem", width: "100%", maxWidth: "480px", maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Tarifs par article</h2>
              <button onClick={() => setShowPricesForm(false)} style={{ background: "none", border: "none", color: "#9AA4AE", cursor: "pointer" }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ fontSize: "0.78rem", color: "#8A8373", marginBottom: "1rem" }}>
              Fixe un prix unitaire par type de vêtement (F CFA). Modifiable à tout moment — les changements s'appliquent aux futures commandes.
            </div>
            {!pricesLoaded ? (
              <div style={{ color: "#9AA4AE", fontSize: "0.9rem" }}>Chargement…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {GARMENT_TYPES.map(type => (
                  <div key={type} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem" }}>
                    <div style={{ fontSize: "0.85rem", flex: 1 }}>{type}</div>
                    <input
                      type="number" min="0"
                      value={unitPrices[type] ?? ""}
                      onChange={(e) => updateUnitPrice(type, parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      style={{ width: "90px", padding: "0.5rem", borderRadius: "9px", border: "1px solid #DDD6C6", background: "#F6F3EC", fontSize: "0.85rem", textAlign: "right" }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showPaymentForm && (() => {
        const order = orders.find(o => o.id === paymentOrderId);
        if (!order) return null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(34,38,44,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
            <div style={{ background: "#FFFDF8", borderTop: "1px solid #E8E1D2", borderRadius: "20px 20px 0 0", padding: "1.25rem", width: "100%", maxWidth: "480px", maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Paiement — {order.client}</h2>
                <button onClick={() => setShowPaymentForm(false)} style={{ background: "none", border: "none", color: "#9AA4AE", cursor: "pointer" }}>
                  <X size={20} />
                </button>
              </div>
              <div style={{ fontSize: "0.82rem", color: "#8A8373", marginBottom: "0.9rem" }}>
                Prix de la commande : <strong>{money(order.price)}</strong>
              </div>
              <Field label="Montant payé à ce jour (F CFA)" value={paymentAmount} onChange={setPaymentAmount} placeholder="0" type="number" />
              <label style={{ display: "block", fontSize: "0.72rem", color: "#8A8373", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Mode de paiement
              </label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                {PAYMENT_METHODS.map(m => (
                  <button key={m} onClick={() => setPaymentMethod(m)} style={{
                    padding: "0.5rem 0.8rem", borderRadius: "9px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600,
                    border: `1px solid ${paymentMethod === m ? "#22262C" : "#DDD6C6"}`,
                    background: paymentMethod === m ? "#22262C" : "#F6F3EC", color: paymentMethod === m ? "#fff" : "#6B6456",
                  }}>{m}</button>
                ))}
              </div>
              {paymentError && <div style={{ color: "#D9634A", fontSize: "0.82rem", marginBottom: "0.4rem" }}>{paymentError}</div>}
              <button onClick={submitPayment} style={{ width: "100%", padding: "0.85rem", background: "#22262C", color: "#F6F3EC", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
                Enregistrer le paiement
              </button>
            </div>
          </div>
        );
      })()}

      {printOrder && (
        <div className="print-ticket" style={{ position: "fixed", top: "-9999px", left: "-9999px" }}>
          <Ticket order={printOrder} />
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, onAdvance, onPrint }) {
  const st = statusOf(order.status);
  const late = isOverdue(order);
  return (
    <div style={{ background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "0.9rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <span style={{
              fontSize: "0.78rem", fontWeight: 800, color: "#22262C", background: "#E9E2D0",
              padding: "0.12rem 0.5rem", borderRadius: "7px", letterSpacing: "0.02em",
            }}>
              {labelCode(order)}
            </span>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>{order.client}</div>
          </div>
          {order.phone && (
            <div style={{ fontSize: "0.78rem", color: "#8A8373", display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.15rem" }}>
              <Phone size={11} /> {order.phone}
            </div>
          )}
        </div>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "0.25rem 0.6rem", borderRadius: "999px", background: st.bg, color: st.color }}>
          {st.label}
        </span>
      </div>

      <div style={{ fontSize: "0.87rem", color: "#4A4438", marginTop: "0.55rem" }}>{order.items}</div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.7rem" }}>
        <div style={{ fontSize: "0.75rem", color: "#9AA4AE" }}>
          Déposé le {fmtDate(order.depositDate)}
          {order.dueDate && (
            <span style={{ color: late ? "#D9634A" : "#9AA4AE" }}>
              {" · "}Prévu le {fmtDate(order.dueDate)}{late ? " (retard)" : ""}
            </span>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{order.price ? money(order.price) : "—"}</div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button onClick={onPrint} style={{
          padding: "0.55rem", background: "#F6F3EC", color: "#22262C", border: "1px solid #DDD6C6",
          borderRadius: "9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }} aria-label="Imprimer le ticket">
          <Printer size={15} />
        </button>
        {order.status !== "recupere" && (
          <button onClick={onAdvance} style={{
            flex: 1, padding: "0.55rem", background: "#22262C", color: "#F6F3EC", border: "none",
            borderRadius: "9px", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
          }}>
            {order.status === "pret" ? <PackageCheck size={14} /> : <CheckCircle2 size={14} />}
            {order.status === "depose" && "Marquer en cours"}
            {order.status === "encours" && "Marquer prêt"}
            {order.status === "pret" && "Marquer récupéré"}
          </button>
        )}
      </div>
    </div>
  );
}

function ClientHistory({ client, onBack, onAdvance, onPrint }) {
  if (!client) return null;
  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#22262C", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, marginBottom: "1rem", padding: 0 }}>
        <ArrowLeft size={16} /> Retour
      </button>
      <div style={{ background: "#FFFDF8", border: "1px solid #E8E1D2", borderRadius: "14px", padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 700, fontSize: "1.15rem" }}>{client.name}</div>
        {client.phone && <div style={{ fontSize: "0.82rem", color: "#8A8373", marginTop: "0.15rem" }}>{client.phone}</div>}
        <div style={{ display: "flex", gap: "1.2rem", marginTop: "0.7rem" }}>
          <div>
            <div style={{ fontSize: "0.68rem", color: "#8A8373", textTransform: "uppercase" }}>Commandes</div>
            <div style={{ fontWeight: 700 }}>{client.orders.length}</div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", color: "#8A8373", textTransform: "uppercase" }}>Total dépensé</div>
            <div style={{ fontWeight: 700 }}>{money(client.total)}</div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: "0.72rem", color: "#8A8373", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.6rem" }}>
        Historique des commandes
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {client.orders
          .sort((a, b) => b.depositDate.localeCompare(a.depositDate))
          .map(o => <OrderCard key={o.id} order={o} onAdvance={() => onAdvance(o.id)} onPrint={() => onPrint(o.id)} />)}
      </div>
    </div>
  );
}

function Ticket({ order }) {
  const nTags = totalGarments(order);
  return (
    <div style={{
      width: "280px", padding: "1rem", fontFamily: "'SF Mono', 'Roboto Mono', monospace",
      color: "#000", background: "#fff", fontSize: "0.78rem", lineHeight: 1.5,
    }}>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "1rem", marginBottom: "0.2rem" }}>PRESSING</div>
      <div style={{ textAlign: "center", fontSize: "0.7rem", marginBottom: "0.6rem" }}>Ticket de dépôt</div>
      <div style={{ borderTop: "1px dashed #000", margin: "0.4rem 0" }} />
      <div style={{ textAlign: "center", fontWeight: 800, fontSize: "1.6rem", letterSpacing: "0.03em", margin: "0.3rem 0" }}>
        {labelCode(order)}
      </div>
      <div style={{ textAlign: "center", fontSize: "0.65rem", color: "#333", marginBottom: "0.3rem" }}>
        N° d'étiquetage — à noter sur chaque vêtement
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "0.4rem 0" }} />
      <div>N° ticket : {ticketNumber(order)}</div>
      <div>Client : {order.client}</div>
      {order.phone && <div>Téléphone : {order.phone}</div>}
      <div>Déposé le : {fmtDate(order.depositDate)}</div>
      {order.dueDate && <div>Retrait prévu : {fmtDate(order.dueDate)}</div>}
      <div style={{ borderTop: "1px dashed #000", margin: "0.4rem 0" }} />
      <div style={{ fontWeight: 700, marginBottom: "0.2rem" }}>Articles :</div>
      <div>{order.items}</div>
      <div style={{ borderTop: "1px dashed #000", margin: "0.4rem 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
        <span>Total</span><span>{order.price ? money(order.price) : "—"}</span>
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "0.4rem 0" }} />
      <div style={{ textAlign: "center", fontSize: "0.68rem", marginTop: "0.4rem" }}>
        Merci de présenter ce ticket au retrait.
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: "0.6rem" }}>
        <img src={qrCodeUrl(order)} alt="QR code du ticket" width={120} height={120} />
      </div>

      <div style={{ borderTop: "2px dashed #000", margin: "0.8rem 0 0.4rem" }} />
      <div style={{ textAlign: "center", fontSize: "0.62rem", color: "#333", marginBottom: "0.3rem" }}>
        ✂️ Découper les étiquettes ci-dessous, une par vêtement
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", justifyContent: "center" }}>
        {Array.from({ length: nTags }).map((_, i) => (
          <div key={i} style={{
            border: "1px dashed #000", borderRadius: "5px", padding: "0.25rem 0.4rem",
            fontWeight: 700, fontSize: "0.85rem", minWidth: "56px", textAlign: "center",
          }}>
            {labelCode(order)}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={{ background: "#2E3339", borderRadius: "12px", padding: "0.7rem 0.9rem", minWidth: "104px", flexShrink: 0, borderTop: `3px solid ${accent}` }}>
      <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "0.68rem", color: "#9AA4AE", marginTop: "0.1rem" }}>{label}</div>
    </div>
  );
}

function FilterChip({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, padding: "0.4rem 0.85rem", borderRadius: "999px",
      border: `1px solid ${active ? (color || "#22262C") : "#DDD6C6"}`,
      background: active ? (color || "#22262C") : "transparent",
      color: active ? "#FFFDF8" : "#6B6456",
      fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    }}>
      {label}
    </button>
  );
}

function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: "none", border: "none", cursor: "pointer",
      display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem",
      padding: "0.4rem 0", color: active ? "#4FAE7A" : "#9AA4AE",
    }}>
      <Icon size={19} strokeWidth={active ? 2.4 : 2} />
      <span style={{ fontSize: "0.62rem", fontWeight: active ? 700 : 500 }}>{label}</span>
    </button>
  );
}

function NotifRow({ color, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span>{text}</span>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ flex: 1, marginBottom: "0.75rem" }}>
      <label style={{ display: "block", fontSize: "0.72rem", color: "#8A8373", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: "#F6F3EC", border: "1px solid #DDD6C6", borderRadius: "10px", padding: "0.6rem 0.75rem", color: "#22262C", fontSize: "0.92rem", boxSizing: "border-box" }} />
    </div>
  );
}
