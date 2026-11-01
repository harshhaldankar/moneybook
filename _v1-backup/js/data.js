/* ========================================
   DATA LAYER - Categories, Storage, Defaults
   ======================================== */

const CATEGORIES = [
    { id: 'food', name: 'Food & Dining', icon: 'fas fa-utensils' },
    { id: 'transport', name: 'Transport', icon: 'fas fa-car' },
    { id: 'rent', name: 'Rent & Utilities', icon: 'fas fa-home' },
    { id: 'subscriptions', name: 'Subscriptions', icon: 'fas fa-tv' },
    { id: 'investments', name: 'Investments', icon: 'fas fa-chart-line' },
    { id: 'emi', name: 'EMI / Loans', icon: 'fas fa-credit-card' },
    { id: 'shopping', name: 'Shopping', icon: 'fas fa-shopping-bag' },
    { id: 'health', name: 'Health', icon: 'fas fa-heartbeat' },
    { id: 'entertainment', name: 'Entertainment', icon: 'fas fa-gamepad' },
    { id: 'education', name: 'Education', icon: 'fas fa-book' },
    { id: 'gifts', name: 'Gifts & Donations', icon: 'fas fa-gift' },
    { id: 'transfers', name: 'Transfers', icon: 'fas fa-exchange-alt' },
    { id: 'salary', name: 'Salary', icon: 'fas fa-briefcase' },
    { id: 'freelance', name: 'Freelance / Side Income', icon: 'fas fa-laptop' },
    { id: 'misc', name: 'Miscellaneous', icon: 'fas fa-ellipsis-h' },
];

const CATEGORY_COLORS = [
    '#6c5ce7', '#00b894', '#e17055', '#fdcb6e', '#74b9ff',
    '#a29bfe', '#55efc4', '#fab1a0', '#ffeaa7', '#81ecec',
    '#dfe6e9', '#fd79a8', '#636e72', '#00cec9', '#d63031'
];

// Default settings
const DEFAULT_SETTINGS = {
    acc1Name: 'Account 1',
    acc2Name: 'Account 2',
    acc1OpeningBalance: 0,
    acc2OpeningBalance: 0,
};

/* --- Storage Helper --- */
const Storage = {
    get(key, fallback = null) {
        try {
            const data = localStorage.getItem(`expenseApp_${key}`);
            return data ? JSON.parse(data) : fallback;
        } catch {
            return fallback;
        }
    },

    set(key, value) {
        try {
            localStorage.setItem(`expenseApp_${key}`, JSON.stringify(value));
        } catch (e) {
            console.error('Storage error:', e);
        }
    },

    remove(key) {
        localStorage.removeItem(`expenseApp_${key}`);
    },

    clearAll() {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('expenseApp_'));
        keys.forEach(k => localStorage.removeItem(k));
    },

    exportAll() {
        const data = {};
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('expenseApp_')) {
                data[key.replace('expenseApp_', '')] = JSON.parse(localStorage.getItem(key));
            }
        });
        return data;
    },

    importAll(data) {
        Object.keys(data).forEach(key => {
            localStorage.setItem(`expenseApp_${key}`, JSON.stringify(data[key]));
        });
    }
};

/* --- ID Generator --- */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/* --- Currency Formatter --- */
function formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* --- Date Formatter --- */
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getMonthYearStr(date) {
    return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/* --- Category Helpers --- */
function getCategoryName(id) {
    const cat = CATEGORIES.find(c => c.id === id);
    return cat ? cat.name : id;
}

function getCategoryIcon(id) {
    const cat = CATEGORIES.find(c => c.id === id);
    return cat ? cat.icon : 'fas fa-question';
}

function getCategoryColor(id) {
    const idx = CATEGORIES.findIndex(c => c.id === id);
    return idx >= 0 ? CATEGORY_COLORS[idx % CATEGORY_COLORS.length] : '#636e72';
}
