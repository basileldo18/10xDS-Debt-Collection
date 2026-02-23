// ============================================
// 10xDS Debt Collection Dashboard - Main JavaScript
// Modern, Interactive Dashboard Logic
// ============================================

// Supabase Configuration
// Supabase Configuration
const SUPABASE_URL = window.SUPABASE_URL; // Injected from index.html
const SUPABASE_KEY = window.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Supabase credentials missing from window config - check template injection");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.appSupabase = supabaseClient; // Use unique name to avoid conflict with library

// Global Variables
let allCalls = [];
let currentSearchTerm = '';
let sentimentChart = null;
let categoriesChart = null;
let performanceChart = null;
let callsVsPaymentsChart = null;
let funnelChart = null;
let currentOffset = 0;
const PAGE_SIZE = 20;
let hasMoreCalls = true;
let totalCallsCount = 0;
let globalStats = null;
let currentAnalyticsDays = 30; // Track the time filter for the analytics page
let currentFilters = {
    sentiments: ['positive', 'neutral', 'negative'],
    dateFrom: null,
    dateTo: null,
    tags: ['Right Party Contact', 'PTP', 'Refusal', 'Dispute', 'Wrong Number', 'Callback Requested', 'Support', 'Billing']
};

class NotificationService {
    constructor() {
        this.container = document.getElementById('vapi-notification-container');
        this.eventSource = null;
        this.init();
    }

    init() {
        if (!this.container) return;

        console.log('[NOTIFY] Initializing Notification Service...');
        this.eventSource = new EventSource('/api/notifications/stream');

        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleNotification(data);
            } catch (e) {
                console.error('[NOTIFY] Error parsing event data:', e);
            }
        };

        this.eventSource.onerror = (err) => {
            console.warn('[NOTIFY] Connection lost. Retrying...', err);
            // EventSource auto-reconnects, but we log it.
        };
    }

    handleNotification(data) {
        console.log('[NOTIFY] Received:', data);

        // Handle call_ended type specifically
        if (data.type === 'call_ended') {
            const duration = data.duration ? `${data.duration}s` : 'Unknown';
            const message = `Duration: ${duration}. Starting call analysis...`;
            this.showToast('📞 Call Ended', message, 'info', 'fa-phone-slash');

            // Show analysis started notification
            setTimeout(() => {
                this.showToast('🔄 Analysis Started', 'Processing recording and generating insights...', 'processing', 'fa-cog');
            }, 500);
            return;
        }

        // Handle vapi_call_started
        if (data.type === 'vapi_call_started') {
            this.showToast('📞 Call Started', data.message || 'A new live call is in progress.', 'success', 'fa-headset');

            // Show indicator in sidebar
            if (window.showSidebarLiveIndicator) {
                window.showSidebarLiveIndicator();
            } else {
                const indicator = document.getElementById('live-call-count');
                if (indicator) {
                    indicator.style.display = 'inline-flex';
                    indicator.textContent = 'Live';
                }
            }

            // Refresh live calls list to show the new call in the table
            if (typeof window.fetchLiveCalls === 'function') {
                window.fetchLiveCalls();
            }
            return;
        }

        // Handle vapi_call_ended
        if (data.type === 'vapi_call_ended') {
            console.log('[NOTIFY] Live call ended:', data.call_id);

            // Hide indicator in sidebar
            if (window.hideSidebarLiveIndicator) {
                window.hideSidebarLiveIndicator();
            } else {
                const indicator = document.getElementById('live-call-count');
                if (indicator) indicator.style.display = 'none';
            }

            // Refresh live calls list to ensure sidebar badge stays in sync with actual DB state
            if (typeof window.fetchLiveCalls === 'function') {
                window.fetchLiveCalls();
            }
            return;
        }

        // Handle different processing steps
        if (data.step) {
            const stepConfig = {
                'start': { title: '🎙️ New Call', icon: 'fa-microphone', type: 'processing' },

                'download': { title: '⬇️ Downloading', icon: 'fa-download', type: 'processing' },
                'upload': { title: '☁️ Storage Upload', icon: 'fa-cloud-upload-alt', type: 'processing' },
                'analyze': { title: '🧠 AI Analysis', icon: 'fa-brain', type: 'processing' },
                'transcribe': { title: '📝 Transcription', icon: 'fa-file-lines', type: 'processing' },
                'save': { title: '💾 Database', icon: 'fa-database', type: 'processing' },
                'done': { title: '✅ Complete', icon: 'fa-check-circle', type: 'success' },
                'error': { title: '❌ Error', icon: 'fa-exclamation-circle', type: 'error' }
            };

            const config = stepConfig[data.step] || { title: '📋 Processing', icon: 'fa-info-circle', type: 'processing' };

            // Determine type based on status
            let toastType = config.type;
            if (data.status === 'complete') toastType = 'success';
            if (data.status === 'error') toastType = 'error';
            if (data.status === 'active') toastType = 'processing';

            // Show toast for ALL important steps
            // Show 'active' status for major steps and 'complete' for all steps
            const shouldShowToast =
                data.status === 'complete' ||  // Show all completion notifications
                data.status === 'error' ||      // Show all errors
                ['transcribe', 'analyze', 'upload', 'save'].includes(data.step) && data.status === 'active'; // Show active for major steps

            if (shouldShowToast) {
                this.showToast(config.title, data.message, toastType, config.icon);
            }

            // Auto-refresh dashboard when save completes (before 'done' step)
            // This ensures faster UI update
            if (data.step === 'save' && data.status === 'complete') {
                console.log('[NOTIFY] Save complete. Triggering dashboard refresh...');
                setTimeout(async () => {
                    try {
                        if (typeof fetchCalls === 'function') {
                            await fetchCalls(false, true); // Force refresh
                        }
                        if (typeof initializeSentimentChart === 'function') {
                            initializeSentimentChart();
                        }
                        console.log('[NOTIFY] Dashboard refreshed successfully!');
                    } catch (error) {
                        console.error('[NOTIFY] Error refreshing dashboard:', error);
                    }
                }, 500); // Small delay to ensure DB transaction is committed
            }

            // Show final success message when completely done
            if (data.step === 'done' && data.status === 'success') {
                console.log('[NOTIFY] Analysis fully complete. Triggering final refresh.');
                // Refresh dashboard when the completion notification arrives
                if (typeof fetchCalls === 'function') {
                    fetchCalls(false, true);
                }
                this.showToast('✨ Processing Complete', 'Your dashboard has been updated!', 'success', 'fa-sparkles');
            }
        }

        // Legacy handling for old format
        if (data.status === 'error' && !data.step) {
            showToast(data.message, 'error');
        } else if ((data.status === 'success' || data.status === 'complete') && !data.step) {
            showToast(data.message, 'success');
        }
    }

    formatStep(step) {
        if (!step) return 'Processing';

        const map = {
            'start': 'Call Received',
            'download': 'Downloading',
            'upload': 'Uploading',
            'analyze': 'Analyzing',
        };
        return map[step] || (typeof step === 'string' ? step.charAt(0).toUpperCase() + step.slice(1) : 'Processing');
    }

    showToast(title, message, type = 'processing', iconClass = 'fa-info-circle') {
        const toast = document.createElement('div');
        toast.className = `vapi-toast ${type}`;

        // Determine icon class (allow passing full classes like 'fa-brands fa-google-drive')
        const finalIconClass = (iconClass.includes('fa-solid') || iconClass.includes('fa-brands') || iconClass.includes('fa-regular'))
            ? iconClass
            : `fa-solid ${iconClass}`;

        toast.innerHTML = `
            <div class="vapi-toast-icon">
                <i class="${finalIconClass}"></i>
            </div>
            <div class="vapi-toast-content">
                <div class="vapi-toast-title">${title}</div>
                <div class="vapi-toast-message">${message}</div>
            </div>
            <button class="vapi-toast-close" onclick="this.parentElement.remove()">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        this.container.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOutLeft 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
}

// ============================================
// DOM Ready Handler
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize UI Elements
    initializeMobileMenu();
    initializeRefreshButton();
    setupSearchListener();
    initializeUploadButton();
    initializeProfileDropdown();
    initializeLoadMoreButton();
    initializeFilterModal();
    initializeExcelUploadButton();
    initializeAnalyticsFilter();

    // Initialize Real-time Notifications
    window.notificationService = new NotificationService();

    // Auth Check - check both Supabase client session and server session
    let user = null;

    // First try Supabase client session
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
        user = session.user;
    } else {
        // Fallback: Check server-side session
        try {
            const serverSession = await fetch('/api/auth/session');
            if (serverSession.ok) {
                const data = await serverSession.json();
                if (data.authenticated) {
                    // Create a minimal user object from server session
                    user = {
                        email: data.email,
                        id: data.user_id,
                        user_metadata: {}
                    };
                }
            }
        } catch (err) {
            console.log('Server session check failed:', err);
        }
    }

    // Only redirect if BOTH sessions are missing
    if (!user) {
        window.location.href = '/login';
        return;
    }

    // Setup User Profile
    setupUserProfile(user);

    // Setup Logout
    setupLogout();

    // Initial navigation state
    updatePageTitle('dashboard');

    // Fetch and Display Data
    await fetchCalls(false, true); // Force initial load

    // Initialize Charts
    initializeSentimentChart();
    initializeCategoriesChart();

    // Sync Settings in Background
    syncSettingsFromApi();

    // Hide Page Loader after data is ready
    hidePageLoader();

    // Secondary auto-refresh fallback (every 30s) in case SSE fails
    setInterval(async () => {
        console.log('[POLL] Running background refresh fallback...');
        await fetchCalls(false, false); // Refresh without loader
        await fetchStats();
        if (typeof initializeSentimentChart === 'function') initializeSentimentChart();
    }, 30000);
});

// Hide Page Loader
function hidePageLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) {
        loader.classList.add('hidden');
        // Optional: Remove from DOM after transition
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }
}

// ============================================
// Analytics Loader Helpers
// ============================================
function showAnalyticsLoader() {
    const loader = document.getElementById('analytics-loader');
    if (loader) {
        loader.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent scrolling
    }
}

function hideAnalyticsLoader() {
    const loader = document.getElementById('analytics-loader');
    if (loader) {
        loader.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// ============================================
// Filter Modal
// ============================================
function initializeFilterModal() {
    const filterBtn = document.getElementById('filter-btn');
    const filterModal = document.getElementById('filter-modal');
    const closeBtn = document.getElementById('filter-modal-close');
    const applyBtn = document.getElementById('filter-apply-btn');
    const resetBtn = document.getElementById('filter-reset-btn');

    if (!filterBtn || !filterModal) return;

    // Open modal
    filterBtn.addEventListener('click', () => {
        // Sync UI with current state
        syncFilterUI();
        filterModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    });

    // Close modal
    const closeModal = () => {
        filterModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Close on overlay click
    filterModal.addEventListener('click', (e) => {
        if (e.target === filterModal) closeModal();
    });

    // Reset filters
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            currentFilters = {
                sentiments: ['positive', 'neutral', 'negative'],
                dateFrom: null,
                dateTo: null,
                tags: ['Right Party Contact', 'PTP', 'Refusal', 'Dispute', 'Wrong Number', 'Callback Requested', 'Support', 'Billing']
            };
            syncFilterUI();
            applyFilters();
            closeModal();
        });
    }

    // Apply filters
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            // Get values from UI
            const sentimentChecks = filterModal.querySelectorAll('input[name="sentiment"]:checked');
            currentFilters.sentiments = Array.from(sentimentChecks).map(cb => cb.value);

            const tagChecks = filterModal.querySelectorAll('input[name="tags"]:checked');
            currentFilters.tags = Array.from(tagChecks).map(cb => cb.value);

            currentFilters.dateFrom = document.getElementById('filter-date-from').value || null;
            currentFilters.dateTo = document.getElementById('filter-date-to').value || null;

            applyFilters();
            closeModal();
        });
    }

    function syncFilterUI() {
        // Sentiments
        const sentimentChecks = filterModal.querySelectorAll('input[name="sentiment"]');
        sentimentChecks.forEach(cb => {
            cb.checked = currentFilters.sentiments.includes(cb.value);
        });

        // Tags
        const tagChecks = filterModal.querySelectorAll('input[name="tags"]');
        tagChecks.forEach(cb => {
            cb.checked = currentFilters.tags.includes(cb.value);
        });

        // Dates
        document.getElementById('filter-date-from').value = currentFilters.dateFrom || '';
        document.getElementById('filter-date-to').value = currentFilters.dateTo || '';
    }
}

// ============================================
// Mobile Menu
// ============================================
function initializeMobileMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }

    // Initialize sidebar navigation
    initializeSidebarNavigation();
}

// ============================================
// Sidebar Navigation
// ============================================
function initializeSidebarNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    // Define which sections belong to which nav item
    const sectionMapping = {
        'dashboard': ['dashboard-section', 'analytics-section', 'calls-section'],
        'calls': ['calls-section'],
        'analytics': ['analytics-section', 'performance-section'],
        'reports': ['reports-section'],
        'settings': ['settings-section'],
        'live-calls': ['live-calls-section'],
        'pending-list': ['pending-list-section']
    };

    // All possible sections
    const allSections = [
        'dashboard-section',
        'analytics-section',
        'performance-section',
        'calls-section',
        'settings-section',
        'reports-section',
        'live-calls-section',
        'pending-list-section'
    ];

    // Initialize: Show only dashboard sections on load
    showSection('dashboard', sectionMapping, allSections);

    navItems.forEach(item => {
        const link = item.querySelector('.nav-link');

        if (link) {
            link.addEventListener('click', (e) => {
                e.preventDefault();

                const sectionName = item.dataset.section;

                if (sectionName) {
                    // Remove active class from all items
                    navItems.forEach(nav => nav.classList.remove('active'));

                    // Add active class to clicked item
                    item.classList.add('active');

                    // Show the appropriate sections
                    showSection(sectionName, sectionMapping, allSections);

                    // If pending-list is selected, fetch the leads
                    if (sectionName === 'pending-list') {
                        fetchPendingLeads();
                    }

                    // Update page title based on section
                    updatePageTitle(sectionName);

                    // Close mobile menu if open
                    if (sidebar) sidebar.classList.remove('open');
                    if (overlay) overlay.classList.remove('active');

                    // Scroll to top of main content
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        mainContent.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                }
            });
        }
    });
}

// Show/Hide sections based on navigation
function showSection(sectionName, sectionMapping, allSections) {
    const sectionsToShow = sectionMapping[sectionName] || [];

    allSections.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            if (sectionsToShow.includes(sectionId)) {
                section.style.display = '';
                section.classList.add('section-active');
                section.classList.remove('section-hidden');
            } else {
                section.style.display = 'none';
                section.classList.remove('section-active');
                section.classList.add('section-hidden');
            }
        }
    });

    // Scoped Stats Management: Ensure Analytics filter doesn't leak to Dashboard
    if (sectionName === 'analytics' || sectionName === 'dashboard') {
        fetchStats(); // This will now automatically use the correct context (currentAnalyticsDays or 30)
    }
}

// ============================================
// Update Page Title
// ============================================
function updatePageTitle(section) {
    const pageTitle = document.querySelector('.page-title');
    const pageSubtitle = document.querySelector('.page-subtitle');

    const titles = {
        'dashboard': { title: 'Dashboard', subtitle: 'Track your call analytics and insights' },
        'calls': { title: 'Call Records', subtitle: 'View and manage all analyzed calls' },
        'analytics': { title: 'Analytics', subtitle: 'Sentiment distribution and category insights' },
        'reports': { title: 'Reports', subtitle: 'Generate and download reports' },
        'settings': { title: 'Settings', subtitle: 'Manage your account and preferences' },
        'live-calls': { title: 'Live Calls', subtitle: 'Monitor active Vapi conversations in real-time' },
        'pending-list': { title: 'Pending Analysis', subtitle: 'View calls currently in the processing queue' }
    };

    const titleData = titles[section] || titles['dashboard'];

    if (pageTitle) pageTitle.textContent = titleData.title;
    if (pageSubtitle) pageSubtitle.textContent = titleData.subtitle;

    // Toggle analytics filters
    const analyticsFilters = document.getElementById('analytics-filters-container');
    if (analyticsFilters) {
        analyticsFilters.style.display = (section === 'analytics') ? 'flex' : 'none';
    }
}

// ============================================
// Analytics Filter Setup (Custom Dropdown)
// ============================================
function initializeAnalyticsFilter() {
    const dropdown = document.getElementById('custom-time-filter');
    const trigger = document.getElementById('time-filter-trigger');
    const menu = document.getElementById('time-filter-menu');
    const triggerText = document.getElementById('time-filter-text');

    if (!dropdown || !trigger || !menu) return;

    // Toggle Dropdown
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    // Handle Item Selection
    menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();

            // Remove active from all
            menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));

            // Add active to clicked
            item.classList.add('active');

            // Update trigger text
            const selectedText = item.querySelector('.item-text').textContent;
            triggerText.textContent = selectedText;

            // Get value
            const days = parseInt(item.dataset.value);
            currentAnalyticsDays = days;
            console.log(`[FILTER] Time range changed to ${days} days (${selectedText})`);

            // Close dropdown
            dropdown.classList.remove('open');

            // Show Loader & Fetch Data
            showAnalyticsLoader();
            try {
                await fetchStats(days);
            } catch (err) {
                console.error('[FILTER] Error updates stats:', err);
            } finally {
                hideAnalyticsLoader();
            }
        });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });
}

// ============================================
// User Profile Setup
// ============================================
function setupUserProfile(user) {
    const userNameEl = document.getElementById('user-name');
    const userEmailEl = document.getElementById('user-email');
    const userAvatarEl = document.getElementById('user-avatar');

    // Get name from metadata or email
    const fullName = user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'User';

    if (userNameEl) {
        userNameEl.textContent = fullName;
    }

    if (userEmailEl) {
        userEmailEl.textContent = user.email || '';
    }

    if (userAvatarEl) {
        userAvatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=6366f1&color=fff&size=80`;
    }

    // Also update dropdown elements
    const dropdownNameEl = document.getElementById('dropdown-user-name');
    const dropdownEmailEl = document.getElementById('dropdown-user-email');
    const dropdownAvatarEl = document.getElementById('dropdown-avatar');

    if (dropdownNameEl) dropdownNameEl.textContent = fullName;
    if (dropdownEmailEl) dropdownEmailEl.textContent = user.email || '';
    if (dropdownAvatarEl) {
        dropdownAvatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=6366f1&color=fff&size=80`;
    }
}

// ============================================
// Logout Handler
// ============================================
// ============================================
// Logout Handler
// ============================================
async function handleLogout() {
    try {
        // Clear server-side session first
        await fetch('/api/auth/logout', { method: 'POST' });
        // Then sign out from Supabase
        await supabaseClient.auth.signOut();

        // Clear search input if present
        const searchInput = document.getElementById('call-search-input');
        if (searchInput) searchInput.value = '';
        currentSearchTerm = '';

    } catch (err) {
        console.error('Logout error:', err);
    }
    window.location.href = '/login';
}

function setupLogout() {
    const logoutBtn = document.getElementById('logout-btn');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

// Initialize Profile Dropdown
function initializeProfileDropdown() {
    const profileTrigger = document.getElementById('profile-trigger');
    const profileDropdown = document.getElementById('profile-dropdown');
    const headerLogoutBtn = document.getElementById('header-logout-btn');

    if (profileTrigger && profileDropdown) {
        // Toggle dropdown on click
        profileTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('active');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!profileTrigger.contains(e.target) && !profileDropdown.contains(e.target)) {
                profileDropdown.classList.remove('active');
            }
        });

        // Handle logout from dropdown
        if (headerLogoutBtn) {
            headerLogoutBtn.addEventListener('click', handleLogout);
        }
    }
}




// ============================================
// Refresh Button
// ============================================
function initializeRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshLiveBtn = document.getElementById('refresh-live-calls');
    const refreshPendingBtn = document.getElementById('refresh-pending-list');

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('loading');
            await fetchCalls(false, true); // Force refresh when manually triggered
            initializeSentimentChart();
            refreshBtn.classList.remove('loading');
            showToast('Data refreshed successfully', 'success');
        });
    }

    if (refreshLiveBtn) {
        refreshLiveBtn.addEventListener('click', async () => {
            const icon = refreshLiveBtn.querySelector('i');
            if (icon) icon.classList.add('fa-spin');
            // assuming fetchLiveCalls exists, or we trigger common live refresh
            if (window.refreshLiveCalls) await window.refreshLiveCalls();
            if (icon) icon.classList.remove('fa-spin');
        });
    }

    if (refreshPendingBtn) {
        refreshPendingBtn.addEventListener('click', async () => {
            const icon = refreshPendingBtn.querySelector('i');
            if (icon) icon.classList.add('fa-spin');
            await fetchPendingLeads();
            if (icon) icon.classList.remove('fa-spin');
            showToast('Pending list refreshed', 'success');
        });
    }

    const clearPendingBtn = document.getElementById('clear-pending-list');
    if (clearPendingBtn) {
        clearPendingBtn.addEventListener('click', clearPendingLeads);
    }
}

// ============================================
// Upload Button
// ============================================
function initializeUploadButton() {
    const uploadBtn = document.getElementById('upload-btn');
    const uploadModal = document.getElementById('upload-modal');
    const uploadModalClose = document.getElementById('upload-modal-close');
    const uploadCancelBtn = document.getElementById('upload-cancel-btn');
    const uploadSubmitBtn = document.getElementById('upload-submit-btn');
    const uploadDropZone = document.getElementById('upload-drop-zone');
    const fileInput = document.getElementById('upload-modal-file-input-batch');

    // Explicitly enforce multiple attribute
    if (fileInput) {
        console.log('[INIT] Force-enabling multiple file selection (ID: upload-modal-file-input-batch)');
        fileInput.multiple = true;
        fileInput.setAttribute('multiple', 'multiple');
    } else {
        console.error('[INIT] Critical Error: File input element not found!');
    }
    const selectedFilesContainer = document.getElementById('selected-files-container');
    const selectedFilesList = document.getElementById('selected-files-list');
    const filesCountLabel = document.getElementById('files-count-label');
    const clearAllBtn = document.getElementById('clear-all-files');
    const progressSection = document.getElementById('upload-progress-section');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressPercent = document.getElementById('upload-percent');
    const uploadStatusText = document.getElementById('upload-status-text');
    const progressFileName = document.getElementById('progress-file-name');
    const batchProgressInfo = document.getElementById('batch-progress-info');

    // Advanced Options Trigger
    const advancedTrigger = document.getElementById('upload-advanced-trigger');
    const advancedContent = document.getElementById('upload-advanced-content');

    if (advancedTrigger && advancedContent) {
        advancedTrigger.onclick = () => {
            const isHidden = advancedContent.style.display === 'none';
            advancedContent.style.display = isHidden ? 'block' : 'none';
            advancedTrigger.classList.toggle('open', isHidden);
        };
    }

    let selectedFiles = [];

    if (!uploadBtn || !uploadModal) return;

    // Open modal
    uploadBtn.addEventListener('click', () => {
        uploadModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        resetUploadModal();
    });

    // Close modal functions
    const closeModal = () => {
        uploadModal.style.display = 'none';
        document.body.style.overflow = '';
        resetUploadModal();
    };

    uploadModalClose.addEventListener('click', closeModal);
    uploadCancelBtn.addEventListener('click', closeModal);
    uploadModal.addEventListener('click', (e) => {
        if (e.target === uploadModal) closeModal();
    });

    // Reset modal state
    function resetUploadModal() {
        selectedFiles = [];
        fileInput.value = '';
        uploadDropZone.style.display = 'block';
        if (selectedFilesContainer) selectedFilesContainer.style.display = 'none';
        if (progressSection) {
            progressSection.style.display = 'none';
            progressSection.classList.remove('complete', 'error');
        }
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (uploadStatusText) uploadStatusText.textContent = 'Uploading...';
        if (uploadSubmitBtn) {
            uploadSubmitBtn.disabled = true;
            uploadSubmitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload';
        }
        if (uploadCancelBtn) {
            uploadCancelBtn.disabled = false;
            uploadCancelBtn.textContent = 'Cancel';
        }
        if (advancedContent) advancedContent.style.display = 'none';
        if (advancedTrigger) {
            advancedTrigger.style.display = 'flex';
            advancedTrigger.classList.remove('open');
        }
    }

    // Click to browse - Dynamic Input Creation to Bypass DOM issues
    uploadDropZone.addEventListener('click', () => {
        console.log('[UPLOAD METHOD] User CLICKED browse area.');
        const dynamicInput = document.createElement('input');
        dynamicInput.type = 'file';
        dynamicInput.multiple = true; // Strictly enforce multiple
        dynamicInput.accept = 'audio/*';
        console.log('[UPLOAD DEBUG] Dynamic input created. Multiple enabled:', dynamicInput.multiple);

        dynamicInput.onchange = (e) => {
            console.log('[UPLOAD DEBUG] Dynamic input change event fired');
            handleFileSelection(e.target.files);
        };

        dynamicInput.click();
    });

    // Drag and drop handlers
    uploadDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy'; // Explicitly indicate copy action
        uploadDropZone.classList.add('drag-over');
    });

    uploadDropZone.addEventListener('dragleave', () => {
        uploadDropZone.classList.remove('drag-over');
    });

    uploadDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadDropZone.classList.remove('drag-over');

        console.log('[UPLOAD METHOD] User DROPPED files.');
        console.log('[DROP DEBUG] dataTransfer types:', e.dataTransfer.types);

        let files = e.dataTransfer.files;

        // Advanced Item Inspect (for debugging Windows/Chrome behavior)
        if (e.dataTransfer.items) {
            console.log(`[DROP DEBUG] Items found: ${e.dataTransfer.items.length}`);
            for (let i = 0; i < e.dataTransfer.items.length; i++) {
                const item = e.dataTransfer.items[i];
                console.log(`[DROP DEBUG] Item ${i}: kind=${item.kind}, type=${item.type}`);
            }
        }

        console.log(`[DROP DEBUG] Final files list length: ${files ? files.length : 0}`);
        handleFileSelection(files);
    });

    // File input change (Fallback for native input triggers)
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            console.log('[UPLOAD METHOD] Native Input Change (Fallback triggered).');
            console.log('[NATIVE DEBUG] Input multiple status:', fileInput.multiple);
            handleFileSelection(e.target.files);
        });
    }

    // Handle file selection
    function handleFileSelection(files) {
        let fileList = files;
        // Fallback: if files is not provided or empty, try the input directly
        if ((!fileList || fileList.length === 0) && fileInput && fileInput.files.length > 0) {
            console.log('[FILE SELECTION] Using fileInput.files fallback');
            fileList = fileInput.files;
        }

        console.log(`[FILE SELECTION] Processing ${fileList ? fileList.length : 0} files.`);

        if (!fileList || fileList.length === 0) {
            console.warn('[FILE SELECTION] No files to process');
            showToast('Debug: Browser reported 0 files selected.', 'error');
            return;
        }

        // Log all received filenames for debugging
        const fileNames = Array.from(fileList).map(f => f.name).join(', ');
        console.log(`[FILE SELECTION] Files received: ${fileNames}`);

        showToast(`Debug: Received ${fileList.length} files: ${fileList.length > 3 ? fileList.length + ' files' : fileNames}`, 'info');

        const allowedExtensions = ['wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac', 'aac'];
        const newFiles = Array.from(fileList);

        let addedCount = 0;
        for (const file of newFiles) {
            const ext = file.name.split('.').pop().toLowerCase();
            console.log(`[FILE SELECTION] Processing ${file.name} (ext: ${ext}, size: ${file.size})`);

            if (allowedExtensions.includes(ext)) {
                // Check for duplicates
                const isDuplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size);
                if (!isDuplicate) {
                    selectedFiles.push(file);
                    addedCount++;
                    console.log(`[FILE SELECTION] Added ${file.name}`);
                } else {
                    console.warn(`[FILE SELECTION] Duplicate skipped: ${file.name}`);
                    showToast(`Debug: Duplicate skipped: ${file.name}`, 'warning');
                }
            } else {
                console.warn(`[FILE SELECTION] Invalid extension skipped: ${file.name}`);
                showToast(`Debug: Skipped invalid extension: ${file.name}`, 'warning');
            }
        }
        console.log(`[FILE SELECTION] Total added: ${addedCount}. New list size: ${selectedFiles.length}`);

        // Reset input value to allow re-selecting same files if needed
        if (fileInput) fileInput.value = '';

        updateSelectedFilesUI();
    }

    function updateSelectedFilesUI() {
        if (selectedFiles.length === 0) {
            uploadDropZone.style.display = 'block';
            if (selectedFilesContainer) selectedFilesContainer.style.display = 'none';
            uploadSubmitBtn.disabled = true;
            return;
        }

        uploadDropZone.style.display = 'none';
        if (selectedFilesContainer) selectedFilesContainer.style.display = 'block';
        uploadSubmitBtn.disabled = false;
        if (filesCountLabel) filesCountLabel.textContent = `Selected Files (${selectedFiles.length})`;

        if (selectedFilesList) {
            selectedFilesList.innerHTML = '';
            selectedFiles.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'file-list-item';
                item.innerHTML = `
                    <div class="file-item-info">
                        <i class="fa-solid fa-file-audio"></i>
                        <div class="file-item-details">
                            <span class="file-item-name">${file.name}</span>
                            <span class="file-item-size">${formatFileSize(file.size)}</span>
                        </div>
                    </div>
                    <div class="file-item-actions">
                        <i class="fa-solid fa-circle-check file-status-icon file-status-pending" id="status-icon-${index}"></i>
                        <button class="btn btn-icon remove-file-item" data-index="${index}">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                `;
                selectedFilesList.appendChild(item);
            });

            // Add remove listeners
            document.querySelectorAll('.remove-file-item').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const index = parseInt(e.currentTarget.dataset.index);
                    selectedFiles.splice(index, 1);
                    updateSelectedFilesUI();
                };
            });
        }
    }

    // Clear all files
    if (clearAllBtn) {
        clearAllBtn.onclick = () => {
            selectedFiles = [];
            updateSelectedFilesUI();
        };
    }

    // Format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Upload submit button
    uploadSubmitBtn.onclick = async () => {
        if (selectedFiles.length === 0) return;

        console.log(`[BATCH UPLOAD] Starting upload for ${selectedFiles.length} files`);
        showToast(`Starting batch upload of ${selectedFiles.length} files...`, 'info');

        // Reset UI for processing
        if (uploadDropZone) uploadDropZone.style.display = 'none';
        if (progressSection) progressSection.style.display = 'block';
        uploadSubmitBtn.disabled = true;
        uploadCancelBtn.disabled = true;
        uploadCancelBtn.textContent = 'Processing...';

        // Hide management buttons during processing
        if (clearAllBtn) clearAllBtn.style.display = 'none';
        document.querySelectorAll('.remove-file-item').forEach(btn => btn.style.display = 'none');

        if (advancedTrigger) advancedTrigger.style.display = 'none';
        if (advancedContent) advancedContent.style.display = 'none';

        const langVal = 'auto';
        const speakersVal = '0';

        let successCount = 0;
        let failCount = 0;

        // Process batch sequentially
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const batchPercent = Math.round((i / selectedFiles.length) * 100);

            // Update batch UI
            if (batchProgressInfo) {
                batchProgressInfo.querySelector('.batch-status').textContent = `Processing ${i + 1} of ${selectedFiles.length} files`;
                batchProgressInfo.querySelector('.batch-percent').textContent = `${batchPercent}%`;
            }

            // Update individual status icon to processing
            updateFileListItemStatus(i, 'processing');

            // Perform single upload
            const success = await performSingleUpload(file, langVal, speakersVal);

            if (success) {
                successCount++;
                updateFileListItemStatus(i, 'complete');
            } else {
                failCount++;
                updateFileListItemStatus(i, 'error');
                // We continue with other files even if one fails
            }

            // Small delay between files to ensure backend resource cleanup
            if (i < selectedFiles.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Complete batch
        const total = selectedFiles.length;
        if (failCount === 0) {
            if (progressSection) progressSection.classList.add('complete');
            if (uploadStatusText) uploadStatusText.textContent = `All ${total} files processed successfully!`;
        } else if (successCount > 0) {
            if (progressSection) progressSection.classList.add('complete');
            if (uploadStatusText) uploadStatusText.textContent = `Completed: ${successCount} successful, ${failCount} skipped/failed.`;
        } else {
            if (progressSection) progressSection.classList.add('error');
            if (uploadStatusText) uploadStatusText.textContent = `All ${total} files failed.`;
        }

        if (batchProgressInfo) {
            batchProgressInfo.querySelector('.batch-percent').textContent = '100%';
        }
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';

        const successMsg = document.getElementById('upload-success-message');
        if (successMsg && successCount > 0) {
            successMsg.style.display = 'flex';
            successMsg.querySelector('span').textContent = failCount === 0
                ? 'All files uploaded and analyzed successfully!'
                : `${successCount} files processed. Check list for individual status.`;
        }

        showToast(`Batch complete: ${successCount} success, ${failCount} fail`, successCount > 0 ? 'success' : 'error');

        uploadCancelBtn.disabled = false;
        uploadCancelBtn.textContent = 'Close';

        // Re-enable UI elements if needed (though we mostly close or show final status)
        if (failCount > 0) {
            // Let them see the errors, but hide the upload button
            uploadSubmitBtn.style.display = 'none';
            fetchCalls(false, true);
            if (typeof initializeSentimentChart === 'function') initializeSentimentChart();
        } else {
            // Auto-close only if all were successful
            setTimeout(() => {
                closeModal();
                fetchCalls(false, true);
                if (typeof initializeSentimentChart === 'function') initializeSentimentChart();
            }, 3000);
        }
    };

    function updateFileListItemStatus(index, state) {
        const icon = document.getElementById(`status-icon-${index}`);
        if (!icon) return;

        icon.className = 'file-status-icon';
        if (state === 'pending') {
            icon.className = 'fa-solid fa-circle file-status-pending';
        } else if (state === 'processing') {
            icon.className = 'fa-solid fa-spinner fa-spin file-status-processing';
        } else if (state === 'complete') {
            icon.className = 'fa-solid fa-circle-check file-status-complete';
        } else if (state === 'error') {
            icon.className = 'fa-solid fa-circle-xmark file-status-error';
        }
    }

    async function performSingleUpload(file, lang, speakers) {
        // Step elements
        const stepUpload = document.getElementById('step-upload');
        const stepTranscribe = document.getElementById('step-transcribe');
        const stepAnalyze = document.getElementById('step-analyze');
        const stepSave = document.getElementById('step-save');

        const stepElements = {
            'upload': { el: stepUpload, statusId: 'step-upload-status' },
            'transcribe': { el: stepTranscribe, statusId: 'step-transcribe-status' },
            'analyze': { el: stepAnalyze, statusId: 'step-analyze-status' },
            'save': { el: stepSave, statusId: 'step-save-status' }
        };

        function updateStep(stepEl, statusId, state, statusText) {
            if (!stepEl) return;
            stepEl.classList.remove('active', 'complete', 'error');
            if (state) stepEl.classList.add(state);
            const statusEl = document.getElementById(statusId);
            if (statusEl) statusEl.textContent = statusText;

            const indicator = stepEl.querySelector('.step-indicator i');
            if (indicator) {
                if (state === 'active') indicator.className = 'fa-solid fa-spinner fa-spin';
                else if (state === 'complete') indicator.className = 'fa-solid fa-check';
                else if (state === 'error') indicator.className = 'fa-solid fa-xmark';
                else indicator.className = 'fa-solid fa-circle';
            }
        }

        // Initialization for current file
        if (progressFileName) progressFileName.textContent = file.name;
        Object.keys(stepElements).forEach(key => updateStep(stepElements[key].el, stepElements[key].statusId, '', 'Waiting...'));
        updateStep(stepElements['upload'].el, 'step-upload-status', 'active', 'In progress...');
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';

        const formData = new FormData();
        formData.append('file', file);
        if (lang && lang !== 'auto') formData.append('language', lang);
        if (speakers && parseInt(speakers) > 0) formData.append('speakers', speakers);

        let explicitCompleted = false;

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error(`[SINGLE UPLOAD] ${file.name} failed with status ${response.status}`, errorData);
                showToast(`Error uploading ${file.name}: ${errorData.error || 'Upload failed'}`, 'error');
                return false;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        let data;
                        try {
                            data = JSON.parse(line.slice(6));
                        } catch (e) { continue; }

                        if (data.step && stepElements[data.step]) {
                            const { el, statusId } = stepElements[data.step];
                            updateStep(el, statusId, data.status, data.message);
                            if (uploadStatusText) uploadStatusText.textContent = data.message;
                        }

                        // Local progress percent
                        const stepOrder = ['upload', 'transcribe', 'analyze', 'save'];
                        const stepIdx = stepOrder.indexOf(data.step);
                        if (stepIdx >= 0) {
                            let percent = Math.round((stepIdx / stepOrder.length) * 100);
                            if (data.status === 'complete') percent = Math.round(((stepIdx + 1) / stepOrder.length) * 100);
                            else if (data.status === 'active') percent += 5;
                            if (progressBar) progressBar.style.width = percent + '%';
                            if (progressPercent) progressPercent.textContent = percent + '%';
                        }

                        if (data.step === 'done' && data.status === 'success') {
                            explicitCompleted = true;
                            return true;
                        }
                        if (data.status === 'error') {
                            console.error(`[SINGLE UPLOAD] ${file.name} reported error:`, data.message);
                            showToast(`${file.name}: ${data.message}`, 'error');
                            return false;
                        }
                    }
                }
            }
            if (!explicitCompleted) {
                console.warn(`[SINGLE UPLOAD] ${file.name} stream ended without 'done' signal.`);
            }
            return explicitCompleted;
        } catch (err) {
            console.error('[SINGLE UPLOAD] Exception:', err);
            return false;
        }
    }
}

// ============================================
// Excel Upload Button
// ============================================
function initializeExcelUploadButton() {
    const excelUploadBtn = document.getElementById('upload-excel-btn');
    const excelUploadModal = document.getElementById('excel-upload-modal');
    const excelModalClose = document.getElementById('excel-upload-modal-close');
    const excelCancelBtn = document.getElementById('excel-upload-cancel');
    const excelSubmitBtn = document.getElementById('excel-upload-submit');
    const excelDropZone = document.getElementById('excel-drop-zone');
    const excelFileInput = document.getElementById('excel-file-input');
    const selectedFileContainer = document.getElementById('excel-selected-file-container');
    const excelFileInfo = document.getElementById('excel-file-info');
    const clearFileBtn = document.getElementById('excel-clear-file');
    const progressSection = document.getElementById('excel-progress-section');
    const progressBar = document.getElementById('excel-progress-bar');
    const progressPercent = document.getElementById('excel-percent');
    const statusText = document.getElementById('excel-status-text');

    if (!excelUploadBtn || !excelUploadModal) return;

    let selectedFile = null;

    // Open modal
    excelUploadBtn.addEventListener('click', () => {
        excelUploadModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        resetExcelModal();
    });

    // Close modal
    const closeModal = () => {
        excelUploadModal.style.display = 'none';
        document.body.style.overflow = '';
        resetExcelModal();
    };

    if (excelModalClose) excelModalClose.addEventListener('click', closeModal);
    if (excelCancelBtn) excelCancelBtn.addEventListener('click', closeModal);
    excelUploadModal.addEventListener('click', (e) => {
        if (e.target === excelUploadModal) closeModal();
    });

    // Reset modal
    function resetExcelModal() {
        selectedFile = null;
        if (excelFileInput) excelFileInput.value = '';
        if (excelDropZone) excelDropZone.style.display = 'block';
        if (selectedFileContainer) selectedFileContainer.style.display = 'none';
        if (progressSection) progressSection.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (statusText) statusText.textContent = 'Processing excel sheet...';
        if (excelSubmitBtn) {
            excelSubmitBtn.disabled = true;
            excelSubmitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload Sheet';
        }
    }

    // Drop zone handling
    if (excelDropZone) {
        excelDropZone.addEventListener('click', () => excelFileInput.click());

        excelDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            excelDropZone.style.borderColor = 'var(--accent-primary)';
            excelDropZone.style.background = 'rgba(99, 102, 241, 0.05)';
        });

        excelDropZone.addEventListener('dragleave', () => {
            excelDropZone.style.borderColor = '#16a34a';
            excelDropZone.style.background = 'rgba(22, 163, 74, 0.05)';
        });

        excelDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });
    }

    if (excelFileInput) {
        excelFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileSelect(e.target.files[0]);
            }
        });
    }

    function handleFileSelect(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx', 'xls', 'csv'].includes(ext)) {
            showToast('Please select a valid Excel or CSV file', 'error');
            return;
        }

        selectedFile = file;
        if (excelDropZone) excelDropZone.style.display = 'none';
        if (selectedFileContainer) selectedFileContainer.style.display = 'block';

        if (excelFileInfo) {
            excelFileInfo.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(0,0,0,0.02); border-radius: 8px;">
                    <i class="fa-solid fa-file-excel" style="font-size: 1.5rem; color: #16a34a;"></i>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: var(--text-primary);">${file.name}</div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">${(file.size / 1024).toFixed(1)} KB</div>
                    </div>
                </div>
            `;
        }
        if (excelSubmitBtn) excelSubmitBtn.disabled = false;
    }

    if (clearFileBtn) clearFileBtn.addEventListener('click', resetExcelModal);

    // Handle upload submit
    if (excelSubmitBtn) {
        excelSubmitBtn.addEventListener('click', async () => {
            if (!selectedFile) return;

            excelSubmitBtn.disabled = true;
            excelSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
            if (progressSection) progressSection.style.display = 'block';

            const formData = new FormData();
            formData.append('file', selectedFile);

            try {
                // Real upload
                const response = await fetch('/api/pending/upload', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    const result = await response.json();

                    if (progressBar) progressBar.style.width = '100%';
                    if (progressPercent) progressPercent.textContent = '100%';
                    if (statusText) statusText.textContent = 'Upload complete!';

                    showToast(result.message || 'Excel file uploaded successfully', 'success');

                    // Refresh the table
                    fetchPendingLeads();

                    setTimeout(closeModal, 1000);
                } else {
                    const error = await response.json();
                    throw new Error(error.detail || error.error || 'Upload failed');
                }

            } catch (err) {
                console.error('[EXCEL UPLOAD] Error:', err);
                showToast(err.message || 'Failed to upload Excel file', 'error');
                excelSubmitBtn.disabled = false;
                excelSubmitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload Sheet';
            }
        });
    }
}

// ============================================
// Pending List Data Management
// ============================================
let pendingLeads = [];

async function fetchPendingLeads() {
    const tableBody = document.getElementById('pending-calls-table-body');
    if (!tableBody) return;

    try {
        const response = await fetch('/api/pending/leads');
        if (response.ok) {
            pendingLeads = await response.json();
            renderPendingLeadsTable();
        }
    } catch (err) {
        console.error('[FETCH LEADS] Error:', err);
    }
}

function renderPendingLeadsTable() {
    const tableBody = document.getElementById('pending-calls-table-body');
    const tableHeader = document.getElementById('pq-table-header-row');
    const countBadge = document.getElementById('pq-queue-count');

    if (!tableBody) return;

    // Update count badge
    if (countBadge) countBadge.textContent = pendingLeads ? pendingLeads.length : 0;

    if (!pendingLeads || pendingLeads.length === 0) {
        // Reset header
        if (tableHeader) {
            tableHeader.innerHTML = `<th style="width:5%">No.</th><th>Data</th><th>Uploaded</th><th>Call Scheduled On</th>`;
        }
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="padding:0;border:none;">
                    <div class="pq-empty-state">
                        <div class="pq-empty-icon">
                            <i class="fa-solid fa-hourglass-half"></i>
                        </div>
                        <h3>No Pending Calls</h3>
                        <p>Upload an Excel file to add calls to the queue</p>
                        <button class="pq-btn pq-btn-success" onclick="document.getElementById('upload-excel-btn').click()" style="margin-top:16px;">
                            <i class="fa-solid fa-file-arrow-up"></i> Upload Excel
                        </button>
                    </div>
                </td>
            </tr>`;
        return;
    }

    // Dynamic headers from first lead's data keys
    const firstLead = pendingLeads[0].lead_data;
    const keys = Object.keys(firstLead).filter(k => !k.toLowerCase().includes('comment'));

    if (tableHeader) {
        tableHeader.innerHTML = `
            <th class="pq-th-num">#</th>
            ${keys.map(k => `<th>${k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')}</th>`).join('')}
            <th>Uploaded</th>
            <th>Call Scheduled On</th>
        `;
    }

    tableBody.innerHTML = pendingLeads.map((lead, idx) => {
        const date = new Date(lead.created_at);
        const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Always use current time + 2 hours
        const scheduledDate = new Date();
        scheduledDate.setHours(scheduledDate.getHours() + 2);
        const scheduledDateStr = scheduledDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const scheduledTimeStr = scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const data = lead.lead_data;

        return `
            <tr class="pq-row">
                <td><span class="pq-row-num">${idx + 1}</span></td>
                ${keys.map(k => {
            const val = String(data[k] || '');
            // Detect numeric/currency values
            const isNum = !isNaN(val) && val.trim() !== '';
            return `<td class="${isNum ? 'pq-td-num' : 'pq-td-text'}">${escapeHtml(val)}</td>`;
        }).join('')}
                <td>
                    <div class="pq-date-chip">
                        <i class="fa-solid fa-clock" style="font-size:0.65rem;opacity:0.6;"></i>
                        ${dateStr}
                    </div>
                    <div class="pq-time-chip">${timeStr}</div>
                </td>
                <td>
                    <div class="pq-date-chip" style="background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.2); color: #22c55e;">
                        <i class="fa-solid fa-calendar-check" style="font-size:0.65rem;opacity:0.6;"></i>
                        ${scheduledDateStr}
                    </div>
                    <div class="pq-time-chip" style="color: #22c55e;">${scheduledTimeStr}</div>
                </td>
            </tr>`;
    }).join('');
}



async function clearPendingLeads() {
    if (!confirm('This will clear the entire pending queue. Are you sure?')) return;

    try {
        const response = await fetch('/api/pending/leads', { method: 'DELETE' });
        if (response.ok) {
            showToast('Pending queue cleared', 'success');
            fetchPendingLeads();
        }
    } catch (err) {
        console.error('[CLEAR LEADS] Error:', err);
    }
}

// ============================================
// Fetch Calls Data
// ============================================
// ============================================
// Settings & Helpers
// ============================================
function loadSettings() {
    const defaults = {
        pageSize: '25',
        autoRefresh: '5',
        dateFormat: 'short'
    };
    try {
        const saved = JSON.parse(localStorage.getItem('voxanalyze-settings'));
        // Migration: Update old default 20s to new 5s automatically
        if (saved && saved.autoRefresh === '20') {
            saved.autoRefresh = '5';
            localStorage.setItem('voxanalyze-settings', JSON.stringify(saved));
        }
        return { ...defaults, ...saved };
    } catch (e) { return defaults; }
}

async function syncSettingsFromApi() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const apiSettings = await response.json();
            if (Object.keys(apiSettings).length > 0) {
                // Merge with defaults to ensure complete object
                const defaults = {
                    pageSize: '25',
                    autoRefresh: '5',
                    dateFormat: 'short'
                };
                const merged = { ...defaults, ...apiSettings };
                localStorage.setItem('voxanalyze-settings', JSON.stringify(merged));
                console.log('[SETTINGS] Synced from API:', merged);
            }
        }
    } catch (e) {
        console.warn('[SETTINGS] Sync failed:', e);
    }
}

function formatDate(dateStr, format) {
    if (!dateStr) return '--';
    const date = new Date(dateStr);

    if (format === 'relative') return timeAgo(date);
    if (format === 'full') {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    // Default 'short'
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

// ============================================
// Fetch Calls Data
// ============================================
const autoRefreshTimerObj = { id: null };
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL = 2000; // Reduced to 2 seconds to allow 5s refresh

async function fetchStats(days = null) {
    // Determine days based on active context if not explicitly provided
    if (days === null) {
        const isAnalyticsActive = document.querySelector('.nav-item[data-section="analytics"]')?.classList.contains('active');
        days = isAnalyticsActive ? currentAnalyticsDays : 30;
    }

    try {
        console.log(`[API CHECK] Fetching call statistics for last ${days} days...`);
        const url = days > 0 ? `/api/call-stats?days=${days}` : '/api/call-stats';
        const response = await fetch(url);

        if (response.ok) {
            const result = await response.json();
            if (result.stats) {
                globalStats = result.stats;
                console.log('[API CHECK] Stats received:', globalStats);
                updateStats(globalStats);
                initializeCategoriesChart(globalStats.tag_counts);
                initializePerformanceChart(globalStats.performance_trend);
                initializeCallsVsPaymentsChart(globalStats.weekly_activity);
                initializeFunnelChart(globalStats.funnel);
                initializeComplianceChart();
                initializeSentimentChart();
            }
        }
    } catch (e) {
        console.error("Failed to fetch stats", e);
    }
}

async function fetchCalls(append = false, force = false) {
    // Throttle API calls to prevent excessive requests
    const now = Date.now();
    if (!force && !append && (now - lastFetchTime) < MIN_FETCH_INTERVAL) {
        console.log(`[API THROTTLE] Skipping fetch - only ${Math.round((now - lastFetchTime) / 1000)}s since last fetch (min: 2s)`);
        return;
    }

    const loadingState = document.getElementById('loading-state');
    const emptyState = document.getElementById('calls-empty-state');
    const tableContainer = document.querySelector('.table-container');
    const loadMoreContainer = document.getElementById('load-more-container');
    const loadMoreBtn = document.getElementById('load-more-btn');
    const loadMoreSpinner = document.getElementById('load-more-spinner');

    if (!append) {
        currentOffset = 0;
        hasMoreCalls = true;
        if (allCalls.length === 0 && loadingState) loadingState.style.display = 'flex';

        // Trigger stats fetch independently (non-blocking)
        fetchStats();
    } else {
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'block';
    }

    if (emptyState) emptyState.style.display = 'none';

    try {
        const response = await fetch(`/api/calls?offset=${currentOffset}&limit=${PAGE_SIZE}&_t=${Date.now()}`);
        if (!response.ok) throw new Error('Failed to fetch calls');

        // Update last fetch time on successful response
        if (!append) {
            lastFetchTime = Date.now();
            console.log('[API CHECK] Fetch completed - next fetch allowed in 20s');
        }

        const result = await response.json();
        console.log('[API DEBUG] Fetch result:', result);

        // Defensive check: handle both old (array) and new (object) formats
        let calls = [];
        if (Array.isArray(result)) {
            calls = result;
            totalCallsCount = Math.max(totalCallsCount, result.length);
        } else if (result && typeof result === 'object') {
            calls = result.calls || [];
            totalCallsCount = result.total || 0;
            // Note: Stats are now fetched separately via fetchStats()
        }

        if (append) {
            allCalls = Array.isArray(allCalls) ? [...allCalls, ...calls] : [...calls];
        } else {
            allCalls = Array.isArray(calls) ? calls : [];
        }

        if (allCalls.length >= totalCallsCount) {
            hasMoreCalls = false;
        }

        currentOffset = allCalls.length;

        if (loadingState) loadingState.style.display = 'none';
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';

        if (allCalls.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            if (tableContainer) tableContainer.style.display = 'none';
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        } else {
            if (emptyState) emptyState.style.display = 'none';
            if (tableContainer) tableContainer.style.display = 'block';
            if (loadMoreContainer) {
                loadMoreContainer.style.display = hasMoreCalls ? 'block' : 'none';
                if (loadMoreBtn) {
                    loadMoreBtn.style.display = 'inline-block';
                    loadMoreBtn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> Load More (${allCalls.length}/${totalCallsCount})`;
                }
            }

            // Handle Auto-Refresh (only on initial load or reset)
            if (!append) {
                if (autoRefreshTimerObj.id) clearTimeout(autoRefreshTimerObj.id);

                const settings = loadSettings();
                const refreshInterval = parseInt(settings.autoRefresh) || 60;

                if (refreshInterval > 0) {
                    autoRefreshTimerObj.id = setTimeout(() => fetchCalls(false), refreshInterval * 1000);
                }
            }

            applyFilters();
            initializeCategoriesChart(globalStats ? globalStats.tag_counts : allCalls);
        }

        console.log('[DEBUG] Calling updateStats with totalCallsCount:', totalCallsCount);
        // CRITICAL FIX: Always update stats, even if list is empty (e.g. filtered view or just loaded)
        updateStats(globalStats || allCalls);

        // Update call count badge (show the TOTAL count)
        const badge = document.getElementById('call-count-badge');
        if (badge) badge.textContent = totalCallsCount;

        // CRITICAL: Directly update the dashboard card too, bypassing animation issues
        const totalCardEl = document.getElementById('total-calls');
        if (totalCardEl) {
            console.log('[DEBUG] Directly updating total-calls card to:', totalCallsCount);
            totalCardEl.textContent = totalCallsCount;
        }

    } catch (error) {
        console.error('Error fetching calls:', error);
        if (loadingState) loadingState.style.display = 'none';
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';

        // Retry auto-refresh even on error after delay
        if (!append) {
            if (autoRefreshTimerObj.id) clearTimeout(autoRefreshTimerObj.id);
            autoRefreshTimerObj.id = setTimeout(() => fetchCalls(false), 60000);
        }
    }
}

// ============================================
// Render Table
// ============================================
// ============================================
// Render Table
// ============================================
function renderTable(callsInput) {
    const tbody = document.getElementById('calls-table-body');

    if (!tbody) return;
    if (!Array.isArray(callsInput)) {
        console.error('[ERROR] renderTable: callsInput is not an array:', callsInput);
        return;
    }

    tbody.innerHTML = '';

    // Apply Pagination Limit
    const settings = loadSettings();
    const limit = parseInt(settings.pageSize) || 25;
    const calls = callsInput.slice(0, limit);

    if (calls.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    No calls match your search criteria
                </td>
            </tr>
        `;
        return;
    }

    calls.forEach((call, index) => {
        const row = document.createElement('tr');

        // Add animation class and staggered delay
        row.classList.add('row-animate');
        row.style.animationDelay = `${index * 50}ms`;

        // Format sentiment
        const sentimentLower = (call.sentiment || 'neutral').toLowerCase();
        let sentimentIcon = 'fa-minus';
        let sentimentClass = 'neutral';

        if (sentimentLower === 'positive') {
            sentimentIcon = 'fa-face-smile';
            sentimentClass = 'positive';
        } else if (sentimentLower === 'negative') {
            sentimentIcon = 'fa-face-frown';
            sentimentClass = 'negative';
        }


        // Format date using Settings
        const dateStr = formatDate(call.created_at, settings.dateFormat);

        // Format duration
        let durationFormatted = '--:--';
        if (call.duration && call.duration > 0) {
            const minutes = Math.floor(call.duration / 60);
            const seconds = call.duration % 60;
            durationFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        // Format email status
        let emailBadgeClass = 'pending';
        let emailIcon = 'fa-clock';
        let emailText = 'Pending';

        if (call.email_sent === true) {
            emailBadgeClass = 'sent';
            emailIcon = 'fa-check';
            emailText = 'Sent';
        } else if (call.email_sent === false) {
            emailBadgeClass = 'failed';
            emailIcon = 'fa-xmark';
            emailText = 'Failed';
        }

        row.innerHTML = `
            <td class="col-call-id">
                <span class="txn-id">
                    ${call.call_id || ('TXN-' + (2801 + (call.id || 0)))}
                </span>
            </td>
            <td class="col-customer">
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    ${(function () {
                let customerName = 'Unknown';
                let summaryData = null;
                try {
                    summaryData = typeof call.summary === 'string' ? JSON.parse(call.summary) : call.summary;
                } catch (e) { }

                if (summaryData) {
                    // Comprehensive search for speakers data
                    const speakers = summaryData.detected_speakers || summaryData.speakers || (summaryData.summary && summaryData.summary.detected_speakers);

                    if (speakers && typeof speakers === 'object') {
                        // Look for Speaker 2 specifically as requested
                        customerName = speakers['Speaker 2'] ||
                            speakers['speaker 2'] ||
                            speakers['Speaker 2 name'] ||
                            speakers['2'] ||
                            speakers['Customer'] ||
                            'Customer';
                    }
                }

                // Final validation to avoid technical strings
                if (customerName === 'Unknown' || customerName === 'Customer') {
                    if (!call.summary || call.summary === '{}' || call.summary === '') {
                        customerName = '<span style="opacity: 0.6; font-style: italic;">Pending...</span>';
                    } else {
                        customerName = 'Customer';
                    }
                }

                return `<span class="filename-cell" title="${escapeHtml(call.filename || 'Unknown')}">${escapeHtml(customerName)}</span>`;
            })()}
                </div>
            </td>
            <td class="col-date">${dateStr}</td>
            <td class="col-duration">
                <span class="duration-badge">
                    <i class="fa-solid fa-clock"></i>
                    ${durationFormatted}
                </span>
            </td>
            <td class="col-sentiment">
                <span class="sentiment-badge ${sentimentClass}">
                    <i class="fa-solid ${sentimentIcon}"></i>
                    ${call.sentiment || 'Neutral'}
                </span>
            </td>
            <td class="col-payment">
                ${(function () {
                let outcome = 'Pending';
                let outcomeClass = 'warning';
                let outcomeIcon = 'fa-hourglass-start';

                // Check metrics
                let metrics = null;
                if (call.summary && typeof call.summary === 'object') {
                    metrics = call.summary.collection_metrics;
                } else if (typeof call.summary === 'string') {
                    try {
                        const parsed = JSON.parse(call.summary);
                        metrics = parsed?.collection_metrics;
                    } catch (e) { }
                }

                if (metrics && metrics.payment_outcome) {
                    const raw = metrics.payment_outcome.toLowerCase();
                    if (raw.includes('full')) { outcome = 'Paid Full'; outcomeClass = 'success'; outcomeIcon = 'fa-check-double'; }
                    else if (raw.includes('partial')) { outcome = 'Partial'; outcomeClass = 'info'; outcomeIcon = 'fa-check'; }
                    else if (raw.includes('promise')) { outcome = 'PTP'; outcomeClass = 'warning'; outcomeIcon = 'fa-handshake'; }
                    else if (raw.includes('refus')) { outcome = 'Refused'; outcomeClass = 'danger'; outcomeIcon = 'fa-ban'; }
                    else if (raw.includes('dispute')) { outcome = 'Dispute'; outcomeClass = 'danger'; outcomeIcon = 'fa-gavel'; }
                    else { outcome = metrics.payment_outcome; outcomeClass = 'secondary'; outcomeIcon = 'fa-circle-question'; }
                } else if (call.tags) {
                    // Fallback to tags
                    const tags = call.tags.map(t => t.toLowerCase());
                    if (tags.some(t => t.includes('full payment'))) { outcome = 'Paid Full'; outcomeClass = 'success'; outcomeIcon = 'fa-check-double'; }
                    else if (tags.some(t => t.includes('partial'))) { outcome = 'Partial'; outcomeClass = 'info'; outcomeIcon = 'fa-check'; }
                    else if (tags.some(t => t.includes('refusal'))) { outcome = 'Refused'; outcomeClass = 'danger'; outcomeIcon = 'fa-ban'; }
                    else if (tags.some(t => t.includes('promise'))) { outcome = 'PTP'; outcomeClass = 'warning'; outcomeIcon = 'fa-handshake'; }
                }

                let isClickable = outcome !== 'Paid Full' && outcome !== 'Pending';
                let clickableClass = isClickable ? 'clickable' : '';

                let badgeHtml = `<span class="badge ${outcomeClass} ${clickableClass}" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 600;">
                                <i class="fa-solid ${outcomeIcon}"></i> 
                                ${outcome}
                                ${isClickable ? '<i class="fa-solid fa-up-right-from-square" style="font-size: 0.6rem; opacity: 0.6; margin-left: 2px;"></i>' : ''}
                            </span>`;

                if (isClickable) {
                    return `<button class="payment-btn" onclick="openPaymentModal('${call.id}')" title="View Payment Details">
                                ${badgeHtml}
                            </button>`;
                } else {
                    return badgeHtml;
                }
            })()}
            </td>
            <td class="col-balance">
                ${(function () {
                // Constants & Initial Values
                let totalDueInput = 0.00;
                let collected = 0.00;
                let method = '';

                // helper
                const parseMoney = (str) => {
                    if (typeof str === 'number') return str;
                    if (!str) return 0.0;
                    return parseFloat(str.replace(/[^0-9.-]+/g, "")) || 0.0;
                };

                // Robust Parsing
                let summaryData = null;
                try {
                    summaryData = typeof call.summary === 'string' ? JSON.parse(call.summary) : call.summary;
                } catch (e) { }

                let metrics = summaryData ? summaryData.collection_metrics : null;

                if (metrics) {
                    collected = parseMoney(metrics.amount_collected);
                    totalDueInput = parseMoney(metrics.total_debt_amount || metrics.total_due || 0);

                    if (metrics.payment_method && !metrics.payment_method.includes('N/A')) {
                        method = metrics.payment_method;
                    }
                }

                // Check for "Not Mentioned" cases
                if (!summaryData || summaryData === '{}' || summaryData === '') {
                    return `<span style="opacity: 0.6; font-style: italic; font-size: 0.75rem;">Pending...</span>`;
                }

                if (totalDueInput === 0 && collected === 0) {
                    return `<span style="opacity: 0.5; color: var(--text-muted); font-size: 0.75rem;">Not Mentioned</span>`;
                }

                // Fallback: If no total due was extracted, but we collected something or it's a known placeholder
                const TOTAL_DUE = totalDueInput > 0 ? totalDueInput : (collected > 0 ? Math.max(collected, 200.00) : 0.00);

                const balance = Math.max(0, TOTAL_DUE - collected);
                const balanceClass = balance > 0 ? 'balance-due' : 'balance-cleared';

                return `<span class="balance-text ${balanceClass}">
                            $${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>`;
            })()}
            </td>

            <td>
                <span class="badge ${call.medium === 'Phone' ? 'info' : (call.medium === 'Web' ? 'secondary' : 'neutral')}" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 600;">
                    <i class="fa-solid ${call.medium === 'Phone' ? 'fa-phone' : (call.medium === 'Web' ? 'fa-globe' : 'fa-question')}"></i> ${call.medium || 'Unknown'}
                </span>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 6px; justify-content: center;">
                    <button class="action-btn details-btn" onclick="openModal('${call.id}')" title="View Details">
                        <i class="fa-solid fa-eye"></i>
                        <span>Details</span>
                    </button>
                    <div class="action-menu-container">
                        <button class="action-btn menu-trigger-btn" onclick="toggleActionMenu(event, '${call.id}')" title="More Actions">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>
                        <div class="action-dropdown" id="action-menu-${call.id}">
                            <button class="action-item" onclick="openReanalyzeModal('${call.id}')">
                                <i class="fa-solid fa-brain"></i> Re-analyze
                            </button>
                            <button class="action-item delete-item" onclick="openDeleteModal('${call.id}')">
                                <i class="fa-solid fa-trash-can"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            </td>
        `;

        // Make entire row clickable
        row.classList.add('clickable-row');
        row.dataset.callId = call.id;

        // Add click handler to row
        row.addEventListener('click', (e) => {
            // Don't open modal if clicking on buttons or interactive elements
            if (e.target.closest('button') ||
                e.target.closest('.action-menu-container') ||
                e.target.closest('.action-dropdown')) {
                return;
            }
            openModal(call.id);
        });

        tbody.appendChild(row);
    });

    // Close action menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.action-menu-container')) {
            document.querySelectorAll('.action-dropdown.active').forEach(menu => {
                menu.classList.remove('active');
                menu.closest('.action-menu-container')?.classList.remove('active');
                // Reset z-index of the row
                const tr = menu.closest('tr');
                if (tr) {
                    tr.style.position = '';
                    tr.style.zIndex = '';
                }
            });
        }
    });
}

function toggleActionMenu(event, callId) {
    event.stopPropagation();

    const menu = document.getElementById(`action-menu-${callId}`);
    const container = event.target.closest('.action-menu-container');

    // Close others and remove active from their containers
    document.querySelectorAll('.action-dropdown.active').forEach(m => {
        if (m.id !== `action-menu-${callId}`) {
            m.classList.remove('active');
            m.closest('.action-menu-container')?.classList.remove('active');
            // Reset z-index of the row
            const tr = m.closest('tr');
            if (tr) {
                tr.style.position = '';
                tr.style.zIndex = '';
            }
        }
    });


    // Toggle current menu and container
    if (menu) {
        const isActive = menu.classList.toggle('active');

        // Handle row z-index to ensure menu appears above other rows
        const tr = container ? container.closest('tr') : null;

        if (isActive) {
            if (tr) {
                tr.style.position = 'relative';
                tr.style.zIndex = '100';
            }
        } else {
            if (tr) {
                tr.style.position = '';
                tr.style.zIndex = '';
            }
        }

        if (container) {
            container.classList.toggle('active');
        }
    }
}

// Payment Modal Logic
window.openPaymentModal = function (callId) {
    const call = allCalls.find(c => c.id == callId);
    if (!call) return;

    const modal = document.getElementById('payment-outcome-modal');
    if (!modal) return;

    // Helper to get nested metrics
    let summaryData = typeof call.summary === 'string' ? JSON.parse(call.summary) : call.summary;
    const metrics = summaryData?.collection_metrics || {};

    // 1. Set Customer Name
    let customerName = 'Customer';
    const speakers = summaryData?.detected_speakers || summaryData?.speakers;
    if (speakers && speakers['Speaker 2']) customerName = speakers['Speaker 2'];
    document.getElementById('payment-modal-customer').textContent = customerName;

    // 2. Set Status Pill
    const outcome = metrics.payment_outcome || 'Pending';
    const statusTextEl = document.getElementById('payment-modal-status-text');
    const statusPill = document.getElementById('payment-modal-status-pill');
    statusTextEl.textContent = outcome;

    statusPill.className = 'payment-status-pill';
    const rawStatus = outcome.toLowerCase();
    if (rawStatus.includes('full')) statusPill.classList.add('success');
    else if (rawStatus.includes('partial') || rawStatus.includes('promise')) statusPill.classList.add('info');
    else if (rawStatus.includes('refus') || rawStatus.includes('dispute')) statusPill.classList.add('danger');

    // 3. Set Metrics
    const formatCurrency = (amount) => {
        const val = parseFloat(amount) || 0;
        return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
    };

    const totalDebt = metrics.total_debt_amount || metrics.total_due || 0;
    const collected = metrics.amount_collected || 0;
    const balance = Math.max(0, totalDebt - collected);

    document.getElementById('pm-total-debt').textContent = formatCurrency(totalDebt);
    document.getElementById('pm-collected').textContent = formatCurrency(collected);
    document.getElementById('pm-balance').textContent = formatCurrency(balance);

    // Enhanced Next Date Fallback: If not in metrics, try to find in summary text
    let nextDate = metrics.next_payment_date || 'N/A';
    const summaryText = summaryData?.summary?.overview || summaryData?.overview || "";

    if (nextDate === 'N/A' && summaryText) {
        // Look for common date patterns like "February 28th", "Feb 28", "28th of Feb"
        const dateMatch = summaryText.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?/i);
        if (dateMatch) {
            nextDate = dateMatch[0];
        }
    }

    document.getElementById('pm-next-date').textContent = nextDate;

    // 4. AI Summary
    const summaryEl = document.getElementById('payment-modal-summary');
    if (summaryData?.summary?.overview || summaryData?.overview) {
        summaryEl.innerHTML = `<p>${summaryData?.summary?.overview || summaryData?.overview}</p>`;
    } else {
        summaryEl.innerHTML = `<p>No detailed summary available for this payment outcome.</p>`;
    }

    // 5. Settlement Box
    const settlementBox = document.getElementById('pm-settlement-box');
    const settlementText = document.getElementById('pm-settlement-details');

    // Try to find settlement details in summary or metrics
    const details = metrics.payment_plan_details || metrics.settlement_agreement || "";
    if (details && details !== "N/A") {
        settlementBox.style.display = 'flex';
        settlementText.innerHTML = `<strong>Settlement Agreed:</strong> ${details} `;
    } else {
        settlementBox.style.display = 'none';
    }

    // 6. Transcript Action
    const transcriptBtn = document.getElementById('btn-pm-view-transcript');
    transcriptBtn.onclick = () => {
        modal.style.display = 'none';
        openModal(callId);
    };

    modal.style.display = 'flex';
};

window.closePaymentModal = function () {
    const modal = document.getElementById('payment-outcome-modal');
    if (modal) modal.style.display = 'none';
};

// Also attach to global object for easy access
window.openPaymentModal.close = window.closePaymentModal;

// ============================================
// Delete Call Functionality
// ============================================
const adminVerifyModal = document.getElementById('admin-verify-modal');
const adminVerifyClose = document.getElementById('admin-verify-close');
const adminVerifyCancel = document.getElementById('admin-verify-cancel');
const adminVerifyConfirm = document.getElementById('admin-verify-confirm');
const adminPasswordInput = document.getElementById('admin-password');
const deleteCallIdInput = document.getElementById('delete-call-id');

function openDeleteModal(callId) {
    if (adminVerifyModal) {
        // Restore original text if it was changed by Re-analyze
        const title = adminVerifyModal.querySelector('.admin-modal-title');
        const desc = adminVerifyModal.querySelector('.admin-modal-desc');
        if (title) title.textContent = 'Delete Confirmation';
        if (desc) desc.textContent = 'This action requires administrator privileges';
        if (adminVerifyConfirm) {
            adminVerifyConfirm.innerHTML = '<i class="fa-solid fa-trash-can"></i> Confirm Delete';
            adminVerifyConfirm.onclick = null; // Use the event listener add for delete
        }

        const warningBox = adminVerifyModal.querySelector('.admin-warning-box');
        if (warningBox) warningBox.style.display = 'flex';

        deleteCallIdInput.value = callId;
        adminPasswordInput.value = ''; // Clear previous password
        adminVerifyModal.style.display = 'flex';
        // Close action menu
        document.getElementById(`action - menu - ${callId} `)?.classList.remove('active');
    }
}

function closeDeleteModal() {
    if (adminVerifyModal) {
        adminVerifyModal.style.display = 'none';
        deleteCallIdInput.value = '';
        adminPasswordInput.value = '';
    }
}

if (adminVerifyClose) adminVerifyClose.addEventListener('click', closeDeleteModal);
if (adminVerifyCancel) adminVerifyCancel.addEventListener('click', closeDeleteModal);

if (adminVerifyConfirm) {
    adminVerifyConfirm.addEventListener('click', async () => {
        const callId = deleteCallIdInput.value;
        const password = adminPasswordInput.value;

        if (!password) {
            showToast('Please enter admin password', 'error');
            return;
        }

        // Disable button and show loading
        const originalBtnText = adminVerifyConfirm.innerHTML;
        adminVerifyConfirm.disabled = true;
        adminVerifyConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

        try {
            const response = await fetch('/api/admin/delete-call', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    call_id: callId,
                    password: password
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showToast('Call deleted successfully', 'success');
                closeDeleteModal();
                // Refresh list
                await fetchCalls(false, true);
                initializeSentimentChart(); // Update charts
            } else {
                showToast(result.error || 'Delete failed', 'error');
            }
        } catch (error) {
            console.error('Delete error:', error);
            showToast('An error occurred during deletion', 'error');
        } finally {
            adminVerifyConfirm.disabled = false;
            adminVerifyConfirm.innerHTML = originalBtnText;
        }
    });
}

// Re-analyze Call Logic
function openReanalyzeModal(callId) {
    // Reuse the admin modal for security
    const modal = document.getElementById('admin-verify-modal');
    if (!modal) return;

    // Change modal text temporarily
    const title = modal.querySelector('.admin-modal-title');
    const desc = modal.querySelector('.admin-modal-desc');
    const confirmBtn = document.getElementById('admin-verify-confirm');
    const passwordInput = document.getElementById('admin-password');

    if (title) title.textContent = 'Re-analyze Call';
    if (desc) desc.textContent = 'Identify speakers using improved LLM logic';

    // Hide deletion warning for re-analysis
    const warningBox = modal.querySelector('.admin-warning-box');
    if (warningBox) warningBox.style.display = 'none';

    // Clear password and store ID
    if (passwordInput) passwordInput.value = '';

    if (confirmBtn) {
        const originalText = confirmBtn.innerHTML;
        const originalFunc = confirmBtn.onclick;

        confirmBtn.innerHTML = '<i class="fa-solid fa-brain"></i> Start Re-analysis';

        // Temporarily override the click handler
        confirmBtn.onclick = async () => {
            const password = passwordInput.value;
            if (!password) {
                showToast('Admin password required', 'error');
                return;
            }

            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';

            try {
                const response = await fetch('/api/admin/reanalyze-call', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ call_id: callId, password: password })
                });

                const result = await response.json();

                if (response.ok) {
                    showToast('Call re-analyzed successfully', 'success');
                    // Update local data
                    const call = allCalls.find(c => c.id == callId);
                    if (call) {
                        call.sentiment = result.sentiment;
                        call.tags = result.tags;
                        call.summary = typeof result.summary === 'string' ? result.summary : JSON.stringify(result.summary);
                        // Refresh table and charts
                        fetchCalls(false, true);
                    }
                    closeDeleteModal();
                } else {
                    showToast(result.error || 'Re-analysis failed', 'error');
                }
            } catch (err) {
                console.error('Re-analysis error:', err);
                showToast('An error occurred during analysis', 'error');
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fa-solid fa-brain"></i> Start Re-analysis';
            }
        };

        // When closing the modal, we'll need to restore the original handler
        // But since we use event listeners for the close/cancel buttons, 
        // we can just reset it in closeDeleteModal if we wanted to be perfectly clean.
        // For now, openDeleteModal also resets the button text and has its own handler (which is an event listener add, so we should be careful about multiple listeners).
    }

    modal.style.display = 'flex';
}
// ============================================
function updateStats(data) {
    const totalEl = document.getElementById('total-calls');
    const rpcEl = document.getElementById('rpc-stat');
    const ptpEl = document.getElementById('ptp-stat');
    const durationEl = document.getElementById('avg-duration');
    const casesResolvedEl = document.getElementById('cases-resolved');

    let totalCallsCount = 0;
    if (Array.isArray(data)) {
        totalCallsCount = data.length;
    } else if (data && typeof data === 'object') {
        totalCallsCount = data.total_calls || data.total || 0;
    }

    if (totalEl) {
        animateCounter(totalEl, totalCallsCount);
    }

    let rpcPercent = 0;
    let ptpPercent = 0;
    let avgSeconds = 0;
    let solved = 0;

    if (Array.isArray(data)) {
        // Fallback: Local calculation from provided array
        const rpcCount = data.filter(c => {
            const tags = (c.tags || []).map(t => t.toLowerCase());
            const rpcTerms = ['right party', 'verified', 'rpc', 'spoke to', 'contacted', 'identity confirmed', 'person reached', 'identity verified'];
            return tags.some(t => rpcTerms.some(term => t.includes(term)));
        }).length;

        const ptpCount = data.filter(c => {
            const tags = (c.tags || []).map(t => t.toLowerCase());
            const ptpTerms = ['promise', 'ptp', 'payment made', 'commitment', 'will pay', 'agreed', 'partial payment', 'full payment', 'commitment to pay'];
            return tags.some(t => ptpTerms.some(term => t.includes(term)));
        }).length;

        rpcPercent = data.length > 0 ? Math.round((rpcCount / data.length) * 100) : 0;
        ptpPercent = data.length > 0 ? Math.round((ptpCount / data.length) * 100) : 0;

        const callsWithDuration = data.filter(c => c.duration && c.duration > 0);
        avgSeconds = callsWithDuration.length > 0 ?
            Math.round(callsWithDuration.reduce((sum, c) => sum + (c.duration || 0), 0) / callsWithDuration.length) : 0;

        solved = data.filter(c => {
            const tgs = (c.tags || []).map(t => t.toLowerCase());
            return tgs.some(t => t.includes('paid full') || t.includes('paid in full') || t.includes('payment made') || t.includes('fully paid'));
        }).length;

    } else if (typeof data === 'object') {
        // Global stats from backend
        // We need to ensure the backend actually provides these specific tag counts or we estimate them from sentiment/tags
        // For now, let's try to use tag_counts if available, or fall back to sentiment mapping as a temporary proxy if tags aren't granular yet

        const tags = data.tag_counts || {};
        const rpcCount = tags['RPC'] || 0;
        const ptpCount = tags['PTP'] || 0;

        // Robustness: Use analyzed_total if available (from fallback backend stats), or total
        const statsTotal = data.analyzed_total || data.total || totalCallsCount || 1;

        rpcPercent = statsTotal > 0 ? Math.round((rpcCount / statsTotal) * 100) : 0;
        ptpPercent = statsTotal > 0 ? Math.round((ptpCount / statsTotal) * 100) : 0;

        // The previous sentiment-based fallback was removed as it was providing misleading values 
        // that confused users (showing sentiment distribution instead of actual RPC/PTP rates).



        avgSeconds = Math.round(data.avg_duration || 0);

        // Calculate resolved cases if not provided directly
        if (data.resolved_cases !== undefined) {
            solved = data.resolved_cases;
        } else {
            solved = (tags['Paid Full'] || 0) + (tags['Payment Made'] || 0) + (tags['Fully Paid'] || 0);
        }
    }

    // Update Cases Solved - ONLY if we have global stats (Object)
    // We avoid updating from Array data because it represents a partial/paged view which would show incorrect low numbers
    if (casesResolvedEl && typeof data === 'object' && !Array.isArray(data)) {
        animateCounter(casesResolvedEl, solved);
    }

    if (rpcEl) animateCounter(rpcEl, rpcPercent, '%');
    if (ptpEl) animateCounter(ptpEl, ptpPercent, '%');

    if (durationEl) {
        if (avgSeconds > 0) {
            const minutes = Math.floor(avgSeconds / 60);
            const seconds = avgSeconds % 60;
            durationEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')} `;
        } else {
            durationEl.textContent = '--:--';
        }
    }


    // --- Collections Metrics Calculation ---
    // If not provided in data, we try to aggregate from the current list (if data is array)
    // or rely on zero if not available.

    let totalCollected = 0.0;
    let fullPayments = 0;
    let partialPayments = 0;
    let unpaid = 0;

    // Helper to safely parse
    const parseFormattedMoney = (str) => {
        if (typeof str === 'number') return str;
        if (!str) return 0.0;
        return parseFloat(str.replace(/[^0-9.-]+/g, "")) || 0.0;
    };

    if (Array.isArray(data)) {
        data.forEach(call => {
            // Check 'collection_metrics' inside summary OR root level if flattened
            let metrics = null;
            if (call.summary && typeof call.summary === 'object') {
                metrics = call.summary.collection_metrics;
            }
            // Fallback: check tags if metrics missing
            if (!metrics && call.tags) {
                const tags = call.tags.map(t => t.toLowerCase());
                if (tags.some(t => t.includes('full payment') || t.includes('paid in full'))) fullPayments++;
                else if (tags.some(t => t.includes('partial') || t.includes('installment'))) partialPayments++;
                else if (tags.some(t => t.includes('refusal') || t.includes('no payment') || t.includes('dispute'))) unpaid++;

                // Estimate amounts from tags if possible (very rough fallback)
                if (tags.includes('payment made')) {
                    // Try to extract money from resolution text? Too complex, skip for now.
                    // Just count it.
                }
            }

            if (metrics) {
                const outcome = (metrics.payment_outcome || '').toLowerCase();
                const amount = parseFormattedMoney(metrics.amount_collected);

                totalCollected += amount;

                if (outcome.includes('full')) fullPayments++;
                else if (outcome.includes('partial')) partialPayments++;
                else if (outcome.includes('refusal') || outcome.includes('no payment') || outcome.includes('dispute')) unpaid++;
            }
        });
    }
    // If data is object (global stats), we assume it might have these fields in future. 
    // For now, if it's the global stats object, we might not have granular call data to sum up.
    // In a real app, the backend /api/call-stats should return these pre-calculated.
    // As a temporary fix, we only update these if we have the array data (from main fetch).
    // If 'data' is the stats object, we skip or set to 0 unless backend is updated.

    const collectedEl = document.getElementById('metrics-collected');
    const fullEl = document.getElementById('metrics-full');
    const partialEl = document.getElementById('metrics-partial');
    const unpaidEl = document.getElementById('metrics-unpaid');

    if (collectedEl) collectedEl.textContent = '$' + totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Animate counts
    if (fullEl) animateCounter(fullEl, fullPayments);
    if (partialEl) animateCounter(partialEl, partialPayments);
    if (unpaidEl) animateCounter(unpaidEl, unpaid);

    // Use fixed stable smaller values as requested
    const hPct = "0.5%", hAmt = "$150 Total";
    const mPct = "3.2%", mAmt = "$550 Total";
    const lPct = "96.3%", lAmt = "$3,500 Total";

    // Update DOM
    const elHighPct = document.getElementById('risk-high-percent');
    const elHighAmt = document.getElementById('risk-high-amount');
    const elMedPct = document.getElementById('risk-medium-percent');
    const elMedAmt = document.getElementById('risk-medium-amount');
    const elLowPct = document.getElementById('risk-low-percent');
    const elLowAmt = document.getElementById('risk-low-amount');

    if (elHighPct) elHighPct.textContent = hPct;
    if (elHighAmt) elHighAmt.textContent = hAmt;

    if (elMedPct) elMedPct.textContent = mPct;
    if (elMedAmt) elMedAmt.textContent = mAmt;

    if (elLowPct) elLowPct.textContent = lPct;
    if (elLowAmt) elLowAmt.textContent = lAmt;
}

// ============================================
// Update Tags Card
// ============================================
function initializeCategoriesChart(data) {
    const canvas = document.getElementById('categories-bar-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // If data is not provided, use globalStats or allCalls
    if (!data) {
        data = globalStats ? globalStats.tag_counts : allCalls;
    }

    let tagCounts = {
        'PTP': 0,
        'Refusal': 0,
        'Dispute': 0,
        'Wrong Number': 0,
        'Callback': 0,
        'RPC': 0
    };

    if (Array.isArray(data)) {
        data.forEach(call => {
            const tags = (call.tags || []).map(t => t.toLowerCase());

            // Check formatted collection_metrics first if available
            if (call.summary && call.summary.collection_metrics) {
                const outcome = (call.summary.collection_metrics.payment_outcome || '').toLowerCase();
                if (outcome.includes('promise')) tagCounts['PTP']++;
                else if (outcome.includes('refus')) tagCounts['Refusal']++;
                else if (outcome.includes('dispute')) tagCounts['Dispute']++;
            }

            // Also check raw tags just in case
            if (tags.some(t => t.includes('promise') || t.includes('ptp') || t.includes('payment made'))) tagCounts['PTP']++;
            if (tags.some(t => t.includes('refusal') || t.includes('not interested'))) tagCounts['Refusal']++;
            if (tags.some(t => t.includes('dispute') || t.includes('complaint'))) tagCounts['Dispute']++;
            if (tags.some(t => t.includes('wrong number'))) tagCounts['Wrong Number']++;
            if (tags.some(t => t.includes('callback'))) tagCounts['Callback']++;
            if (tags.some(t => t.includes('right party') || t.includes('verified') || t.includes('rpc'))) tagCounts['RPC']++;
        });
    } else if (typeof data === 'object') {
        // Fix: logic to handle if data IS the tag_counts object (passed from fetchStats) 
        // or if it's the stats object containing tag_counts
        const counts = data.tag_counts || data;
        tagCounts['PTP'] = counts['PTP'] || 0;
        tagCounts['Refusal'] = counts['Refusal'] || 0;
        tagCounts['Dispute'] = counts['Dispute'] || 0;
        tagCounts['Wrong Number'] = counts['Wrong Number'] || 0;
        tagCounts['Callback'] = counts['Callback'] || 0;
        tagCounts['RPC'] = counts['RPC'] || 0;
    }

    // Destroy existing chart
    if (categoriesChart) {
        categoriesChart.destroy();
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const barColor = isDark ? '#6366f1' : '#6366f1';
    const barColorLight = isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.2)';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    // Labels and Data
    const labels = Object.keys(tagCounts);
    const values = Object.values(tagCounts);

    categoriesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: labels.map((_, i) => i % 2 === 0 ? '#6366f1' : '#a855f7'),
                borderRadius: {
                    topLeft: 12,
                    topRight: 12,
                    bottomLeft: 0,
                    bottomRight: 0
                },
                borderSkipped: false,
                barThickness: 32,
                maxBarThickness: 40
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : 'white',
                    titleColor: isDark ? '#f1f5f9' : '#0f172a',
                    bodyColor: isDark ? '#f1f5f9' : '#0f172a',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: {
                            family: "'Inter', sans-serif",
                            size: 11,
                            weight: '600'
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: gridColor,
                        borderDash: [5, 5],
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: {
                            family: "'Inter', sans-serif",
                            size: 11
                        },
                        stepSize: 1
                    }
                }
            }
        }
    });
}



// Performance Chart (NEW)
function initializePerformanceChart(trendData) {
    const ctx = document.getElementById('performance-line-chart');
    if (!ctx) return;

    // Destroy existing chart
    if (performanceChart) {
        performanceChart.destroy();
    }

    // Default data if none provided
    if (!trendData || trendData.length === 0) {
        // Fallback demo data
        trendData = [
            { "month": "Jan", "total_due": 0, "collected": 0, "balance": 0 },
            { "month": "Feb", "total_due": 0, "collected": 0, "balance": 0 },
            { "month": "Mar", "total_due": 0, "collected": 0, "balance": 0 }
        ];
    }

    const labels = trendData.map(d => d.month);
    const dueData = trendData.map(d => d.total_due);
    const collectedData = trendData.map(d => d.collected);
    const balanceData = trendData.map(d => d.balance);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Total Due',
                    data: dueData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 3,
                    pointBackgroundColor: '#ef4444',
                    fill: false
                },
                {
                    label: 'Collected',
                    data: collectedData,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 3,
                    pointBackgroundColor: '#22c55e',
                    fill: true
                },
                {
                    label: 'Balance',
                    data: balanceData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.4,
                    pointRadius: 3,
                    pointBackgroundColor: '#f59e0b',
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // Custom legend used
                },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : 'white',
                    titleColor: isDark ? '#f1f5f9' : '#0f172a',
                    bodyColor: isDark ? '#f1f5f9' : '#0f172a',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: { size: 11 },
                        callback: function (value) {
                            if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'k';
                            return '$' + value;
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: textColor,
                        font: { size: 11 }
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false,
            }
        }
    });
}

// ============================================
// Sentiment Chart
// ============================================
function initializeSentimentChart() {
    const canvas = document.getElementById('sentiment-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Count sentiments
    let positive = 0, neutral = 0, negative = 0;

    if (globalStats && globalStats.sentiment) {
        positive = globalStats.sentiment.positive || 0;
        neutral = globalStats.sentiment.neutral || 0;
        negative = globalStats.sentiment.negative || 0;
    } else {
        // Fallback to local data
        if (!Array.isArray(allCalls)) {
            console.error('[ERROR] allCalls is not an array:', allCalls);
            allCalls = [];
        }

        allCalls.forEach(call => {
            const sentiment = (call.sentiment || 'neutral').toLowerCase();
            if (sentiment === 'positive') positive++;
            else if (sentiment === 'negative') negative++;
            else neutral++;
        });
    }

    // Destroy existing chart
    if (sentimentChart) {
        sentimentChart.destroy();
    }

    // Determine colors based on theme
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tooltipBg = isDark ? '#1e293b' : 'white';
    const tooltipText = isDark ? '#f1f5f9' : '#0f172a';
    const tooltipBorder = isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0';

    // Calculate total and percentages
    const total = positive + neutral + negative;
    const posPercent = total > 0 ? Math.round((positive / total) * 100) : 0;
    const neuPercent = total > 0 ? Math.round((neutral / total) * 100) : 0;
    const negPercent = total > 0 ? Math.round((negative / total) * 100) : 0;

    // Update UI elements
    const totalEl = document.getElementById('sentiment-total-calls');
    if (totalEl) totalEl.textContent = total;

    const updateLevel = (id, percent, barId) => {
        const percentEl = document.getElementById(id);
        const barEl = document.getElementById(barId);
        if (percentEl) percentEl.textContent = `${percent}% `;
        if (barEl) barEl.style.width = `${percent}% `;
    };

    updateLevel('percent-positive', posPercent, 'bar-positive');
    updateLevel('percent-neutral', neuPercent, 'bar-neutral');
    updateLevel('percent-negative', negPercent, 'bar-negative');

    // Create new chart
    sentimentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Positive', 'Neutral', 'Negative'],
            datasets: [{
                data: [positive, neutral, negative],
                backgroundColor: [
                    isDark ? '#22c55e' : '#10b981', // Positive
                    isDark ? '#64748b' : '#cbd5e1', // Neutral
                    isDark ? '#ef4444' : '#ef4444'  // Negative
                ],
                borderWidth: isDark ? 2 : 0,
                borderColor: isDark ? '#1e293b' : 'transparent',
                hoverOffset: 15,
                borderRadius: isDark ? 6 : 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '80%', // Slightly thinner for more elegance
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: tooltipBg,
                    titleColor: tooltipText,
                    bodyColor: tooltipText,
                    borderColor: tooltipBorder,
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    usePointStyle: true
                }
            },
            animation: {
                animateScale: true,
                animateRotate: true
            }
        }
    });
}

// Calls vs Payments Chart (NEW)
function initializeCallsVsPaymentsChart(weeklyData) {
    const ctx = document.getElementById('calls-vs-payments-chart');
    if (!ctx) return;

    // Destroy existing chart
    if (callsVsPaymentsChart) {
        callsVsPaymentsChart.destroy();
    }

    // Default data if none provided
    if (!weeklyData || weeklyData.length === 0) {
        weeklyData = [
            { "day": "Mon", "calls": 0, "payments": 0 },
            { "day": "Tue", "calls": 0, "payments": 0 },
            { "day": "Wed", "calls": 0, "payments": 0 },
            { "day": "Thu", "calls": 0, "payments": 0 },
            { "day": "Fri", "calls": 0, "payments": 0 },
            { "day": "Sat", "calls": 0, "payments": 0 },
            { "day": "Sun", "calls": 0, "payments": 0 }
        ];
    }

    const labels = weeklyData.map(d => d.day);
    const callsData = weeklyData.map(d => d.calls);
    const paymentsData = weeklyData.map(d => d.payments);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    callsVsPaymentsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Calls',
                    data: callsData,
                    backgroundColor: '#6366f1',
                    borderRadius: 4,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                },
                {
                    label: 'Payments',
                    data: paymentsData,
                    backgroundColor: '#a855f7',
                    borderRadius: 4,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // Using custom legend
                },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : 'white',
                    titleColor: isDark ? '#f1f5f9' : '#0f172a',
                    bodyColor: isDark ? '#f1f5f9' : '#0f172a',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y;
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: { size: 11 }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: textColor,
                        font: { size: 11 }
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false,
            }
        }
    });
}

// Conversion Funnel Chart (NEW)
function initializeFunnelChart(funnelData) {
    const ctx = document.getElementById('conversion-funnel-chart');
    if (!ctx) return;

    // Destroy existing chart
    if (funnelChart) {
        funnelChart.destroy();
    }

    // Default data if none provided
    if (!funnelData) {
        funnelData = {
            "calls_made": 0,
            "connected": 0,
            "ptp": 0,
            "payment": 0
        };
    }

    // Check if empty fallback
    if (Object.values(funnelData).every(v => v === 0)) {
        funnelData = {
            "calls_made": 1000,
            "connected": 750,
            "ptp": 300,
            "payment": 180
        };
    }

    const labels = ["Calls Made", "Connected", "Promise to Pay", "Payment Received"];
    const dataValues = [
        funnelData.calls_made,
        funnelData.connected,
        funnelData.ptp,
        funnelData.payment
    ];

    // Color gradient concept (start blue -> end green/teal)
    const backgroundColors = [
        '#60a5fa', // Blue 400
        '#a78bfa', // Violet 400
        '#f472b6', // Pink 400
        '#34d399'  // Emerald 400
    ];

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    funnelChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Count',
                    data: dataValues,
                    backgroundColor: backgroundColors,
                    borderRadius: 4,
                    barPercentage: 0.5,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            indexAxis: 'y', // Horizontal Layout
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : 'white',
                    titleColor: isDark ? '#f1f5f9' : '#0f172a',
                    bodyColor: isDark ? '#f1f5f9' : '#0f172a',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: {
                        color: gridColor,
                        drawBorder: false,
                        borderDash: [5, 5]
                    },
                    ticks: {
                        color: textColor,
                        font: { size: 11 }
                    }
                },
                y: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: textColor,
                        font: { size: 11, weight: 600 }
                    }
                }
            }
        }
    });
}

// Compliance Adherence Chart (NEW)
let complianceChart = null;

function initializeComplianceChart() {
    const ctx = document.getElementById('compliance-chart');
    if (!ctx) return;

    // Destroy existing chart
    if (complianceChart) {
        complianceChart.destroy();
    }

    // Mock Data based on user image
    // Green Line: ~96, ~96.5, ~95, ~98
    // Red Line: ~4, ~3, ~4.5, ~2
    const labels = ['W1', 'W2', 'W3', 'W4'];
    const adherenceData = [96.0, 96.5, 95.2, 97.4]; // Green (High Adherence)
    const violationData = [4.5, 3.8, 4.8, 2.6];   // Red (Low Violations/Risk)

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    complianceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Adherence Score',
                    data: adherenceData,
                    borderColor: '#10b981', // Emerald Green
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    yAxisID: 'y',
                    tension: 0.4,
                    pointBackgroundColor: '#10b981',
                    pointRadius: 4,
                    borderWidth: 2,
                    fill: false
                },
                {
                    label: 'Risk/Violations',
                    data: violationData,
                    borderColor: '#ef4444', // Red
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    yAxisID: 'y1',
                    tension: 0.4,
                    pointBackgroundColor: '#ef4444',
                    pointRadius: 4,
                    borderWidth: 2,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: isDark ? '#1e293b' : 'white',
                    titleColor: isDark ? '#f1f5f9' : '#0f172a',
                    bodyColor: isDark ? '#f1f5f9' : '#0f172a',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10
                }
            },
            scales: {
                x: {
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: { size: 11 }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 90,
                    max: 100,
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        stepSize: 3
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: 8,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: textColor,
                        stepSize: 2
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false,
            }
        }
    });
}

// ============================================
// Modal & UI Interactions
// ============================================
window.openModal = async function (callId) {
    const modal = document.getElementById('transcript-modal');
    const modalFilename = document.getElementById('modal-filename');
    const modalText = document.getElementById('modal-text');
    const modalDate = document.getElementById('modal-date');
    const modalSentiment = document.getElementById('modal-sentiment');
    const modalTags = document.getElementById('modal-tags');
    const modalSummary = document.getElementById('modal-summary');
    const modalAudio = document.getElementById('modal-audio');
    const audioStatus = document.getElementById('audio-status');

    // Find call data
    let call = allCalls.find(c => c.id == callId);

    if (!call) {
        showToast('Call not found', 'error');
        return;
    }

    // Show modal immediately
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    // Initial title (will be updated after loading details if needed)
    if (modalFilename) {
        modalFilename.textContent = 'Loading...';
    }

    // Lazy Load: Check if we have transcript/diarization. If not, fetch it.
    if (!call.transcript && !call.diarization_data) {
        console.log(`[MODAL] Fetching details for call ${callId}...`);

        // Show Loading Overlay
        const modalContent = modal.querySelector('.modal-content');
        let loader = modalContent.querySelector('.modal-loading-overlay');
        if (!loader) {
            loader = document.createElement('div');
            loader.className = 'modal-loading-overlay';
            loader.innerHTML = `
                    <div class="loading-spinner"></div>
                    <p>Loading call details...</p>
                <style>
                    .modal-loading-overlay {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(255, 255, 255, 0.9);
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        z-index: 100;
                        border-radius: 12px;
                        backdrop-filter: blur(4px);
                    }
                    .dark-mode .modal-loading-overlay {
                        background: rgba(30, 41, 59, 0.9);
                    }
                    .modal-loading-overlay .loading-spinner {
                        border: 3px solid rgba(99, 102, 241, 0.2);
                        border-top: 3px solid #6366f1;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin-bottom: 16px;
                    }
                    .modal-loading-overlay p {
                        color: var(--text-secondary);
                        font-weight: 500;
                    }
                </style>
            `;
            // Ensure modal content is relative so absolute positioning works
            if (getComputedStyle(modalContent).position === 'static') {
                modalContent.style.position = 'relative';
            }
            modalContent.appendChild(loader);
        }
        loader.style.display = 'flex';

        try {
            const response = await fetch(`/api/calls/${callId}`);
            if (response.ok) {
                const fullData = await response.json();
                // Merge full data into the existing call object (updates cache)
                Object.assign(call, fullData);
                console.log('[MODAL] Details loaded successfully.');
            } else {
                console.error('[MODAL] Failed to load details:', response.status);
                showToast('Failed to load call details', 'error');
            }
        } catch (e) {
            console.error('[MODAL] Error loading details:', e);
            showToast('Error loading call details', 'error');
        } finally {
            // Hide Loader
            if (loader) {
                loader.style.animation = 'fadeOut 0.3s ease forwards';
                setTimeout(() => {
                    loader.style.display = 'none';
                    loader.style.animation = ''; // Reset for next time
                }, 300);
            }
        }
    }

    // Populate transcript with diarization if available
    if (modalText) {
        const diarizationData = call.diarization_data || [];
        const speakerCount = call.speaker_count || 0;

        // Debug: Log what data we have
        console.log('[DIARIZATION DEBUG] call.diarization_data:', call.diarization_data);
        console.log('[DIARIZATION DEBUG] call.speaker_count:', call.speaker_count);
        console.log('[DIARIZATION DEBUG] diarizationData length:', diarizationData.length);

        // Try to get speaker identification from summary if available
        let detectedSpeakers = {};
        try {
            const rawSummary = call.summary || '';
            const sData = typeof rawSummary === 'string' ? JSON.parse(rawSummary) : rawSummary;

            // Check for detected_speakers in various possible locations
            let speakersData = sData.detected_speakers || (sData.summary && sData.summary.detected_speakers) || {};

            // Handle both array and object formats
            if (Array.isArray(speakersData)) {
                speakersData.forEach((name, index) => {
                    if (name && name.trim()) {
                        detectedSpeakers[`Speaker ${index + 1} `] = name.trim();
                    }
                });
            } else if (typeof speakersData === 'object' && speakersData !== null) {
                // Normalize 0-indexed to 1-indexed if Speaker 0 is found
                if ('Speaker 0' in speakersData) {
                    Object.keys(speakersData).forEach(key => {
                        const match = key.match(/Speaker\s*(\d+)/i);
                        if (match) {
                            const num = parseInt(match[1]);
                            detectedSpeakers[`Speaker ${num + 1} `] = speakersData[key];
                        } else {
                            detectedSpeakers[key] = speakersData[key];
                        }
                    });
                } else {
                    detectedSpeakers = speakersData;
                }
            }
        } catch (e) {
            console.error('[SPEAKER DETECTION] Error parsing speakers:', e);
        }

        // Show speaker count badge next to filename
        const speakerBadge = document.getElementById('speaker-badge-display');
        const speakerCountText = document.getElementById('speaker-count-text');

        if (speakerBadge && speakerCount > 0) {
            speakerCountText.textContent = `${speakerCount} Speaker${speakerCount > 1 ? 's' : ''} `;
            speakerBadge.style.display = 'inline-flex';
        } else if (speakerBadge) {
            speakerBadge.style.display = 'none';
        }

        // UPDATE TITLE TO SPEAKER 2 NAME (Customer)
        if (modalFilename) {
            let customerName = '';

            // Try Speaker 2 from detectedSpeakers
            if (detectedSpeakers['Speaker 2']) {
                customerName = detectedSpeakers['Speaker 2'].split(',')[0].trim();
            } else if (detectedSpeakers['speaker 2']) {
                customerName = detectedSpeakers['speaker 2'].split(',')[0].trim();
            } else if (detectedSpeakers['2']) {
                customerName = detectedSpeakers['2'].split(',')[0].trim();
            } else if (detectedSpeakers['Customer']) {
                customerName = detectedSpeakers['Customer'].split(',')[0].trim();
            }

            if (customerName) {
                modalFilename.textContent = customerName;
            } else {
                modalFilename.textContent = 'Call Analysis';
            }
            modalFilename.title = call.filename || 'Unknown';
        }

        if (diarizationData.length > 0) {
            // Build speaker-labeled transcript
            let transcriptHtml = '';

            transcriptHtml += '<div class="diarized-transcript">';

            // Create a map to convert A, B, C... to Speaker 1, Speaker 2, Speaker 3...
            const speakerMap = {};
            let speakerIndex = 1;

            diarizationData.forEach((utterance, idx) => {
                const originalSpeaker = utterance.speaker || 'Unknown';

                // Simple logic: Use display_name if manually edited, otherwise use detected name, otherwise use Speaker N
                let displaySpeaker;
                if (utterance.display_name) {
                    // User has manually edited this speaker's name
                    displaySpeaker = utterance.display_name;
                } else {
                    // First time seeing this speaker - assign Speaker N
                    if (!speakerMap[originalSpeaker]) {
                        speakerMap[originalSpeaker] = `Speaker ${speakerIndex} `;
                        speakerIndex++;
                    }
                    const mappedSpeaker = speakerMap[originalSpeaker];

                    // Check if LLM detected a name for this speaker
                    const detectedName = detectedSpeakers[mappedSpeaker];
                    if (detectedName && typeof detectedName === 'string') {
                        // Extract only the name part (before any comma)
                        displaySpeaker = detectedName.split(',')[0].trim();
                    } else {
                        // No detected name, use Speaker N
                        displaySpeaker = mappedSpeaker;
                    }
                }

                const timestamp = formatTimestamp(utterance.start);
                const speakerClass = getSpeakerClass(originalSpeaker);
                const startTimeMs = utterance.start || 0;

                transcriptHtml += `
                    <div class="utterance-line" data-index="${idx}">
                        <span class="utterance-timestamp clickable-timestamp" data-time="${startTimeMs}" title="Click to jump to this point">[${timestamp}]</span>
                        <span class="speaker-label ${speakerClass}" contenteditable="true" data-original="${escapeHtml(originalSpeaker)}">${escapeHtml(displaySpeaker)}</span>
                        <span class="utterance-text" contenteditable="true" dir="auto">${escapeHtml(utterance.text)}</span>
                    </div>
                `;
            });

            transcriptHtml += '</div>';
            modalText.innerHTML = transcriptHtml;

            // Setup speaker name auto-update listeners with save functionality
            setupSpeakerEditListeners(call.id, diarizationData);

            // Setup transcript text edit listeners with save functionality
            setupTranscriptTextEditListeners(call.id, diarizationData);

            // Setup timestamp click listeners to seek audio
            setupTimestampClickListeners();
        } else {
            // Fallback to plain transcript
            modalText.innerHTML = `<p dir="auto">${escapeHtml(call.transcript || 'No transcript available')}</p>`;
        }
    }

    // Populate summary
    if (modalSummary) {
        const rawSummary = call.summary || 'No summary available';
        let summaryHtml = '';

        try {
            const summaryData = typeof rawSummary === 'string' ? JSON.parse(rawSummary) : rawSummary;

            if (typeof summaryData !== 'object' || summaryData === null) {
                throw new Error("Summary is not an object");
            }

            // Build structured summary HTML with translation button
            summaryHtml = '<div class="structured-summary">';

            // Add translation header
            summaryHtml += '<div class="summary-translate-header">';
            summaryHtml += '<h4 class="summary-main-title"><i class="fa-solid fa-brain" style="margin-right: 8px; color: var(--accent-primary);"></i> AI Summary</h4>';
            summaryHtml += `
                <div class="summary-translate-dropdown">
                    <button class="summary-translate-btn" onclick="toggleSummaryTranslate(event)">
                        <i class="fa-solid fa-language"></i>
                        <span>Translate</span>
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <div class="summary-translate-menu" id="summary-translate-menu">
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'en', event)">
                            <span class="lang-flag">🇬🇧</span>
                            English
                        </button>
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'ml', event)">
                            <span class="lang-flag">🇮🇳</span>
                            Malayalam
                        </button>
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'hi', event)">
                            <span class="lang-flag">🇮🇳</span>
                            Hindi
                        </button>
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'ar', event)">
                            <span class="lang-flag">🇸🇦</span>
                            Arabic
                        </button>
                    </div>
                </div>
            `;
            summaryHtml += '</div>';

            // Overview section
            if (summaryData.overview) {
                summaryHtml += `
                    <div class="summary-section overview-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-lightbulb"></i>
                            <strong>Overview</strong>
                        </div>
                        <p class="summary-overview">${escapeHtml(summaryData.overview)}</p>
                    </div>
                `;
            }

            // Key Points section
            if (summaryData.key_points && summaryData.key_points.length > 0) {
                summaryHtml += `
                    <div class="summary-section key-points-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-list-check"></i>
                            <strong>Key Points</strong>
                        </div>
                        <ul class="key-points-list">
                            ${summaryData.key_points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Caller Intent section
            if (summaryData.caller_intent) {
                summaryHtml += `
                    <div class="summary-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-bullseye"></i>
                            <strong>What the Caller Wanted</strong>
                        </div>
                        <p>${escapeHtml(summaryData.caller_intent)}</p>
                    </div>
                `;
            }

            // Issue Details section
            if (summaryData.issue_details) {
                summaryHtml += `
                    <div class="summary-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-exclamation-circle"></i>
                            <strong>Issue / Topic</strong>
                        </div>
                        <p>${escapeHtml(summaryData.issue_details)}</p>
                    </div>
                `;
            }

            // Resolution section
            if (summaryData.resolution) {
                summaryHtml += `
                    <div class="summary-section resolution-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-check-circle"></i>
                            <strong>Resolution / Outcome</strong>
                        </div>
                        <p>${escapeHtml(summaryData.resolution)}</p>
                    </div>
                `;
            }

            // 5. Action Items section
            if (summaryData.action_items && summaryData.action_items.length > 0) {
                summaryHtml += `
                    <div class="summary-section action-items-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-tasks"></i>
                            <strong>Next Steps / Action Items</strong>
                        </div>
                        <ul class="action-items-list">
                            ${summaryData.action_items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // 6. Collection Metrics section (NEW)
            const metrics = summaryData.collection_metrics;
            if (metrics) {
                const totalDue = parseFloat(metrics.total_debt_amount || metrics.total_due || 0);
                const collected = parseFloat(metrics.amount_collected || 0);
                const balance = Math.max(0, totalDue - collected);

                summaryHtml += `
                    <div class="summary-section metrics-section" style="border-left: 4px solid var(--accent-primary); background: rgba(99, 102, 241, 0.05); padding: 16px; border-radius: 8px; margin-top: 20px;">
                        <div class="summary-section-header" style="margin-bottom: 12px; color: var(--accent-primary);">
                            <i class="fa-solid fa-file-invoice-dollar"></i>
                            <strong>Collection Metrics</strong>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 16px;">
                            <div class="metric-item">
                                <span style="display: block; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Total Due</span>
                                <span style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">$${totalDue.toFixed(2)}</span>
                            </div>
                            <div class="metric-item">
                                <span style="display: block; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Collected</span>
                                <span style="font-size: 1.1rem; font-weight: 700; color: var(--text-success);">$${collected.toFixed(2)}</span>
                            </div>
                            <div class="metric-item">
                                <span style="display: block; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Balance</span>
                                <span style="font-size: 1.1rem; font-weight: 700; color: var(--text-warning);">$${balance.toFixed(2)}</span>
                            </div>
                            <div class="metric-item">
                                <span style="display: block; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Outcome</span>
                                <span class="badge ${getOutcomeClass(metrics.payment_outcome)}" style="font-size: 0.8rem; margin-top: 4px;">${escapeHtml(metrics.payment_outcome || 'Pending')}</span>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Tone section
            if (summaryData.tone) {
                const toneClass = getToneClass(summaryData.tone);
                summaryHtml += `
                    <div class="summary-section tone-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-comment"></i>
                            <strong>Conversation Tone</strong>
                        </div>
                        <span class="tone-badge ${toneClass}">${escapeHtml(summaryData.tone)}</span>
                    </div>
                `;
            }

            summaryHtml += '</div>';
        } catch (e) {
            // Not JSON or parsing failed, display as plain text
            const textToDisplay = typeof rawSummary === 'string' ? rawSummary : JSON.stringify(rawSummary, null, 2);
            summaryHtml = `<p>${escapeHtml(textToDisplay)}</p>`;
        }

        modalSummary.innerHTML = summaryHtml;
    }

    if (modalDate && call.created_at) {
        modalDate.textContent = new Date(call.created_at).toLocaleString();
    }

    if (modalSentiment) {
        modalSentiment.textContent = call.sentiment || 'Neutral';
    }

    if (modalTags) {
        modalTags.innerHTML = (call.tags || []).map(tag => {
            let tagClass = 'default';
            const lower = tag.toLowerCase();
            if (lower.includes('bill')) tagClass = 'billing';
            if (lower.includes('support')) tagClass = 'support';
            if (lower.includes('churn')) tagClass = 'churn';
            return `<span class="tag ${tagClass}">${escapeHtml(tag)}</span>`;
        }).join('');
    }

    // Setup audio player
    if (modalAudio) {
        if (call.audio_url) {
            modalAudio.src = call.audio_url;
            modalAudio.style.display = 'block';
            if (audioStatus) {
                audioStatus.innerHTML = '<i class="fa-solid fa-headphones"></i> Listen to Call';
            }
        } else {
            modalAudio.src = '';
            modalAudio.style.display = 'none';
            if (audioStatus) {
                audioStatus.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> Audio not available';
                audioStatus.style.color = 'var(--text-muted)';
            }
        }
    }

    // Show modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Reset to first tab (Summary)
    const modalTabs = document.querySelectorAll('.modal-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    modalTabs.forEach((t, i) => t.classList.toggle('active', i === 0));
    tabContents.forEach((c, i) => c.classList.toggle('active', i === 0));

    // Setup copy button
    setupCopyButton(call);

    // Setup translation button
    setupTranslationButton(call);
};

// Setup translation button handler
function setupTranslationButton(call) {
    const translateBtn = document.getElementById('translate-btn');
    const languageSelect = document.getElementById('translation-language');
    const translationOutput = document.getElementById('modal-translation');

    if (translateBtn) {
        translateBtn.onclick = async () => {
            const language = languageSelect?.value || 'es';

            // Show loading state
            translateBtn.disabled = true;
            translateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Translating...';
            translationOutput.innerHTML = '<p class="translation-loading"><i class="fa-solid fa-globe fa-spin"></i> Translating transcript...</p>';

            try {
                // Debug: Log what we're sending to the server
                console.log('[TRANSLATION DEBUG] Sending diarization_data:', call.diarization_data);
                console.log('[TRANSLATION DEBUG] diarization_data length:', call.diarization_data?.length || 0);

                const response = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        transcript: typeof call.transcript === 'object' ? JSON.stringify(call.transcript) : (call.transcript || ''),
                        language: language,
                        diarization_data: call.diarization_data || [],
                        call_id: call.id
                    })
                });

                const result = await response.json();

                // Debug: Log what we received from the server
                console.log('[TRANSLATION DEBUG] Response:', result);
                console.log('[TRANSLATION DEBUG] has_diarization:', result.has_diarization);
                console.log('[TRANSLATION DEBUG] translated_diarization:', result.translated_diarization);
                console.log('[TRANSLATION DEBUG] Original call diarization_data:', call.diarization_data);

                if (result.success) {
                    // Build formatted translation output
                    let translationHtml = `
                    <div class="translation-header">
                        <span class="translation-language-badge">
                            <i class="fa-solid fa-globe"></i>
                            Translated to ${result.language}
                        </span>
                    </div>
                `;

                    // Check if we have diarized translation with timestamps
                    if (result.has_diarization && result.translated_diarization) {
                        translationHtml += '<div class="diarized-transcript translated-diarized">';

                        // Build speaker map from original diarization data to inherit edited names
                        const speakerNameMap = {};
                        let speakerIndex = 1;

                        // Try to get speaker identification from summary if available
                        let detectedSpeakers = {};
                        try {
                            const sData = typeof call.summary === 'string' ? JSON.parse(call.summary) : call.summary;
                            let speakersData = sData.detected_speakers || {};
                            if (sData.summary && sData.summary.detected_speakers) {
                                speakersData = sData.summary.detected_speakers;
                            }

                            // Handle both array and object formats
                            if (Array.isArray(speakersData)) {
                                // Convert array ['Paula Heberling', 'Agent'] to object {'Speaker 1': 'Paula Heberling', 'Speaker 2': 'Agent'}
                                speakersData.forEach((name, index) => {
                                    if (name && name.trim()) {
                                        detectedSpeakers[`Speaker ${index + 1} `] = name.trim();
                                    }
                                });
                            } else if (typeof speakersData === 'object') {
                                // Already in correct format
                                detectedSpeakers = speakersData;
                            }
                        } catch (e) {
                            console.error('[SPEAKER DETECTION] Error parsing speakers:', e);
                        }

                        // First pass: build map from original diarization (which has display_name from edits)
                        if (call.diarization_data && call.diarization_data.length > 0) {
                            call.diarization_data.forEach(utterance => {
                                const originalSpeaker = utterance.speaker || 'Unknown';
                                if (!speakerNameMap[originalSpeaker]) {
                                    if (utterance.display_name) {
                                        speakerNameMap[originalSpeaker] = utterance.display_name;
                                    } else {
                                        const mappedLabel = `Speaker ${speakerIndex} `;
                                        // Priority: LLM Detected -> Speaker Index
                                        speakerNameMap[originalSpeaker] = detectedSpeakers[mappedLabel] || mappedLabel;
                                        speakerIndex++;
                                    }
                                }
                            });
                        }

                        // Store translated diarization for editing
                        const translatedDiarization = result.translated_diarization;

                        result.translated_diarization.forEach((utterance, idx) => {
                            const originalSpeaker = utterance.speaker || 'Unknown';

                            // Use speaker name from our map (inherits edited names from original transcript)
                            let displaySpeaker = speakerNameMap[originalSpeaker];
                            if (!displaySpeaker) {
                                displaySpeaker = utterance.display_name || `Speaker ${speakerIndex} `;
                                // Extract only name part (before comma) if LLM added role info
                                if (typeof displaySpeaker === 'string' && displaySpeaker.includes(',')) {
                                    displaySpeaker = displaySpeaker.split(',')[0].trim();
                                }
                                speakerNameMap[originalSpeaker] = displaySpeaker;
                                speakerIndex++;
                            }

                            const timestamp = formatTimestamp(utterance.start);
                            const speakerClass = getSpeakerClass(originalSpeaker);
                            const startTimeMs = utterance.start || 0;

                            translationHtml += `
                                <div class="utterance-line" data-index="${idx}">
                                    <span class="utterance-timestamp clickable-timestamp" data-time="${startTimeMs}" title="Click to jump to this point">[${timestamp}]</span>
                                    <span class="speaker-label ${speakerClass}" data-original="${escapeHtml(originalSpeaker)}">${escapeHtml(displaySpeaker)}</span>
                                    <span class="utterance-text">${escapeHtml(utterance.text)}</span>
                                </div>
                            `;
                        });

                        translationHtml += '</div>';
                        translationOutput.innerHTML = translationHtml;

                        // Setup clickable timestamps for translated content
                        setupTimestampClickListeners();
                    } else if (result.translated_text) {
                        // Plain text translation fallback
                        translationHtml += '<div class="translated-transcript">';
                        const lines = result.translated_text.split('\n');
                        lines.forEach(line => {
                            if (line.trim()) {
                                translationHtml += `<p class="translated-paragraph">${escapeHtml(line)}</p>`;
                            }
                        });
                        translationHtml += '</div>';
                        translationOutput.innerHTML = translationHtml;
                    }

                    showToast(`Translated to ${result.language} `, 'success');
                } else {
                    translationOutput.innerHTML = `<p class="translation-error"><i class="fa-solid fa-exclamation-triangle"></i> ${result.error || 'Translation failed'}</p>`;
                    showToast('Translation failed', 'error');
                }
            } catch (error) {
                console.error('Translation error:', error);
                translationOutput.innerHTML = '<p class="translation-error"><i class="fa-solid fa-exclamation-triangle"></i> Error connecting to translation service</p>';
                showToast('Translation error', 'error');
            } finally {
                // Reset button
                translateBtn.disabled = false;
                translateBtn.innerHTML = '<i class="fa-solid fa-language"></i> Translate';
            }
        };
    }
}

// Setup speaker name edit listeners for translation view
// Edits in translation sync back to original diarization data and update both views
function setupTranslatedSpeakerEditListeners(callId, originalDiarizationData, translatedDiarization) {
    // Select only speaker labels within the translation tab
    const translationContainer = document.getElementById('modal-translation');
    if (!translationContainer) return;

    const speakerLabels = translationContainer.querySelectorAll('.speaker-label[contenteditable="true"]');

    speakerLabels.forEach(label => {
        // Store original display name for tracking
        label.dataset.displayName = label.textContent.trim();

        // Handle Enter key press
        label.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.blur(); // Trigger blur to apply changes
            }
        });

        // Handle blur (when clicking away or pressing Enter)
        label.addEventListener('blur', async function () {
            const newName = this.textContent.trim();
            const originalDisplayName = this.dataset.displayName;
            const originalSpeakerId = this.dataset.original; // Original speaker ID (A, B, etc.)

            // Only update if the name actually changed
            if (newName && newName !== originalDisplayName) {
                // Update all speaker labels with the same original display name in BOTH transcript and translation tabs
                const allLabels = document.querySelectorAll('.speaker-label[contenteditable="true"]');

                allLabels.forEach(otherLabel => {
                    if (otherLabel.dataset.displayName === originalDisplayName) {
                        otherLabel.textContent = newName;
                        otherLabel.dataset.displayName = newName; // Update stored name
                    }
                });

                // Update the original diarization data array with new speaker names
                if (originalDiarizationData && originalSpeakerId) {
                    originalDiarizationData.forEach(utterance => {
                        if (utterance.speaker === originalSpeakerId) {
                            utterance.display_name = newName;
                        }
                    });

                    // Save to database
                    try {
                        const response = await fetch(`/api/calls/${callId}/diarization`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diarization_data: originalDiarizationData })
                        });

                        if (response.ok) {
                            showToast(`Saved: "${originalDisplayName}" → "${newName}"`, 'success');
                        } else {
                            showToast('Failed to save changes', 'error');
                        }
                    } catch (error) {
                        console.error('Error saving diarization:', error);
                        showToast('Error saving changes', 'error');
                    }
                } else {
                    showToast(`Updated all "${originalDisplayName}" to "${newName}"`, 'success');
                }
            }
        });
    });
}

// Helper: Format milliseconds to MM:SS timestamp
function formatTimestamp(ms) {
    if (!ms && ms !== 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Setup timestamp click listeners to seek audio player
function setupTimestampClickListeners() {
    const timestamps = document.querySelectorAll('.clickable-timestamp');
    const audioPlayer = document.getElementById('modal-audio');

    timestamps.forEach(timestamp => {
        timestamp.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering parent element events

            const timeMs = parseInt(timestamp.dataset.time, 10);
            const timeSeconds = timeMs / 1000;

            if (audioPlayer && audioPlayer.src) {
                // Seek to the timestamp
                audioPlayer.currentTime = timeSeconds;

                // Start playing if paused
                if (audioPlayer.paused) {
                    audioPlayer.play().catch(err => {
                        console.log('Audio playback failed:', err);
                    });
                }

                // Highlight the clicked line
                document.querySelectorAll('.utterance-line').forEach(line => {
                    line.classList.remove('active-utterance');
                });
                const parentLine = timestamp.closest('.utterance-line');
                if (parentLine) {
                    parentLine.classList.add('active-utterance');
                }

                showToast(`Jumped to ${formatTimestamp(timeMs)}`, 'success');
            } else {
                showToast('Audio not available', 'error');
            }
        });
    });
}

// Helper: Get CSS class for speaker coloring
function getSpeakerClass(speaker) {
    if (!speaker) return 'speaker-a';
    const speakerUpper = speaker.toUpperCase();
    if (speakerUpper === 'A' || speakerUpper === 'SPEAKER A') return 'speaker-a';
    if (speakerUpper === 'B' || speakerUpper === 'SPEAKER B') return 'speaker-b';
    if (speakerUpper === 'C' || speakerUpper === 'SPEAKER C') return 'speaker-c';
    if (speakerUpper === 'D' || speakerUpper === 'SPEAKER D') return 'speaker-d';
    return 'speaker-a';
}

// Helper: Get CSS class for conversation tone styling
function getToneClass(tone) {
    if (!tone) return 'tone-neutral';
    const toneLower = tone.toLowerCase();
    if (toneLower.includes('friendly') || toneLower.includes('positive') || toneLower.includes('happy') || toneLower.includes('pleasant')) {
        return 'tone-positive';
    }
    if (toneLower.includes('frustrated') || toneLower.includes('angry') || toneLower.includes('upset') || toneLower.includes('rude')) {
        return 'tone-negative';
    }
    if (toneLower.includes('professional') || toneLower.includes('formal') || toneLower.includes('business')) {
        return 'tone-professional';
    }
    if (toneLower.includes('urgent') || toneLower.includes('anxious') || toneLower.includes('stressed')) {
        return 'tone-urgent';
    }
    return 'tone-neutral';
}

// Helper: Get CSS class for collection outcome styling
function getOutcomeClass(outcome) {
    if (!outcome) return 'tone-neutral';
    const lower = outcome.toLowerCase();
    if (lower.includes('full') || lower.includes('success') || lower.includes('paid')) {
        return 'tone-positive';
    }
    if (lower.includes('promise') || lower.includes('ptp')) {
        return 'tone-professional';
    }
    if (lower.includes('refusal') || lower.includes('no payment') || lower.includes('failed')) {
        return 'tone-negative';
    }
    if (lower.includes('dispute')) {
        return 'tone-urgent';
    }
    return 'tone-neutral';
}

// Setup speaker name edit listeners for auto-updating all instances and saving to DB
function setupTranscriptTextEditListeners(callId, diarizationData) {
    const textElements = document.querySelectorAll('.utterance-text[contenteditable="true"]');

    textElements.forEach(textEl => {
        const parentLine = textEl.closest('.utterance-line');
        const index = parentLine ? parseInt(parentLine.dataset.index) : -1;

        if (index === -1) return;

        // Store original text
        textEl.dataset.originalText = textEl.textContent.trim();

        // Handle Enter key
        textEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.blur();
            }
        });

        // Handle blur to save
        textEl.addEventListener('blur', async function () {
            const newText = this.textContent.trim();
            const originalText = this.dataset.originalText;

            if (newText !== originalText) {
                // Update local array
                if (diarizationData[index]) {
                    diarizationData[index].text = newText;
                    this.dataset.originalText = newText;

                    // Save to database
                    try {
                        const response = await fetch(`/api/calls/${callId}/diarization`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diarization_data: diarizationData })
                        });

                        if (response.ok) {
                            showToast('Transcript updated', 'success');

                            // Also update the global transcript string for other uses (like copy)
                            const call = allCalls.find(c => c.id == callId);
                            if (call) {
                                call.transcript = diarizationData.map(d => d.text).join(' ');
                            }
                        } else {
                            showToast('Failed to save transcript', 'error');
                        }
                    } catch (error) {
                        console.error('Error saving transcript:', error);
                        showToast('Error saving transcript', 'error');
                    }
                }
            }
        });
    });
}

function setupSpeakerEditListeners(callId, diarizationData) {
    const speakerLabels = document.querySelectorAll('.speaker-label[contenteditable="true"]');

    speakerLabels.forEach(label => {
        // Store original display name for tracking
        label.dataset.displayName = label.textContent.trim();

        // Handle Enter key press
        label.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.blur(); // Trigger blur to apply changes
            }
        });

        // Handle blur (when clicking away or pressing Enter)
        label.addEventListener('blur', async function () {
            const newName = this.textContent.trim();
            const originalDisplayName = this.dataset.displayName;
            const originalSpeakerId = this.dataset.original; // Original speaker ID (A, B, etc.)

            // Only update if the name actually changed
            if (newName && newName !== originalDisplayName) {
                // Find all speaker labels with the same original display name
                const allLabels = document.querySelectorAll('.speaker-label[contenteditable="true"]');

                allLabels.forEach(otherLabel => {
                    if (otherLabel.dataset.displayName === originalDisplayName) {
                        otherLabel.textContent = newName;
                        otherLabel.dataset.displayName = newName; // Update stored name
                    }
                });

                // Update the diarization data array with new speaker names
                if (diarizationData && originalSpeakerId) {
                    diarizationData.forEach(utterance => {
                        if (utterance.speaker === originalSpeakerId) {
                            utterance.display_name = newName;
                        }
                    });

                    // Save to database
                    try {
                        const response = await fetch(`/api/calls/${callId}/diarization`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diarization_data: diarizationData })
                        });

                        if (response.ok) {
                            showToast(`Saved: "${originalDisplayName}" → "${newName}"`, 'success');
                        } else {
                            showToast('Failed to save changes', 'error');
                        }
                    } catch (error) {
                        console.error('Error saving diarization:', error);
                        showToast('Error saving changes', 'error');
                    }
                } else {
                    showToast(`Updated all "${originalDisplayName}" to "${newName}"`, 'success');
                }
            }
        });
    });
}

function setupCopyButton(call) {
    const copyBtn = document.getElementById('copy-transcript-btn');

    if (copyBtn) {
        copyBtn.onclick = () => {
            let textToCopy = '';

            // Try to get structured transcript from the displayed DOM (most reliable)
            const modalText = document.getElementById('modal-text');
            const diarizedTranscript = modalText?.querySelector('.diarized-transcript');

            if (diarizedTranscript) {
                // Extract from the rendered transcript display
                const utteranceLines = diarizedTranscript.querySelectorAll('.utterance-line');

                utteranceLines.forEach(line => {
                    const timestamp = line.querySelector('.utterance-timestamp')?.textContent?.trim() || '';
                    const speaker = line.querySelector('.speaker-label')?.textContent?.trim() || '';
                    const text = line.querySelector('.utterance-text')?.textContent?.trim() || '';

                    // Format: [MM:SS] Speaker Name: Text
                    textToCopy += `${timestamp} ${speaker}: ${text}\n`;
                });
            } else {
                // Fallback: Try to use diarization data from call object
                if (call.diarization_data && call.diarization_data.length > 0) {
                    const diarizationData = call.diarization_data;

                    // Build speaker map (same logic as display)
                    const speakerMap = {};
                    let speakerIndex = 1;

                    // Try to get speaker identification from summary
                    let detectedSpeakers = {};
                    try {
                        const sData = typeof call.summary === 'string' ? JSON.parse(call.summary) : call.summary;
                        let speakersData = sData.detected_speakers || {};
                        if (sData.summary && sData.summary.detected_speakers) {
                            speakersData = sData.summary.detected_speakers;
                        }

                        // Handle both array and object formats
                        if (Array.isArray(speakersData)) {
                            // Convert array ['Paula Heberling', 'Agent'] to object {'Speaker 1': 'Paula Heberling', 'Speaker 2': 'Agent'}
                            speakersData.forEach((name, index) => {
                                if (name && name.trim()) {
                                    detectedSpeakers[`Speaker ${index + 1}`] = name.trim();
                                }
                            });
                        } else if (typeof speakersData === 'object') {
                            // Already in correct format
                            detectedSpeakers = speakersData;
                        }
                    } catch (e) {
                        console.error('[SPEAKER DETECTION] Error parsing speakers:', e);
                    }

                    // Format each utterance
                    diarizationData.forEach((utterance) => {
                        const originalSpeaker = utterance.speaker || 'Unknown';

                        // Simple logic: Use display_name if manually edited, otherwise use detected name, otherwise use Speaker N
                        let displaySpeaker;
                        if (utterance.display_name) {
                            // User has manually edited this speaker's name
                            displaySpeaker = utterance.display_name;
                        } else {
                            // First time seeing this speaker - assign Speaker N
                            if (!speakerMap[originalSpeaker]) {
                                speakerMap[originalSpeaker] = `Speaker ${speakerIndex}`;
                                speakerIndex++;
                            }
                            const mappedSpeaker = speakerMap[originalSpeaker];

                            // Check if LLM detected a name for this speaker
                            const detectedName = detectedSpeakers[mappedSpeaker];
                            if (detectedName && typeof detectedName === 'string') {
                                // Extract only the name part (before any comma)
                                displaySpeaker = detectedName.split(',')[0].trim();
                            } else {
                                // No detected name, use Speaker N
                                displaySpeaker = mappedSpeaker;
                            }
                        }

                        const timestamp = formatTimestamp(utterance.start);
                        const text = utterance.text || '';

                        // Format: [MM:SS] Speaker Name: Text
                        textToCopy += `[${timestamp}] ${displaySpeaker}: ${text}\n`;
                    });
                } else {
                    // Last resort: plain transcript
                    textToCopy = call.transcript || '';
                }
            }

            navigator.clipboard.writeText(textToCopy)
                .then(() => showToast('Transcript copied to clipboard', 'success'))
                .catch(() => showToast('Failed to copy transcript', 'error'));
        };
    }
}

// Close modal handlers
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('transcript-modal');
    const closeBtn = document.querySelector('.close-modal');
    const backdrop = document.querySelector('.modal-backdrop');

    const closeModal = () => {
        if (modal) {
            const modalContent = modal.querySelector('.modal-content');
            const modalBackdrop = modal.querySelector('.modal-backdrop');

            // Add closing animation classes
            if (modalContent) modalContent.classList.add('closing');
            if (modalBackdrop) modalBackdrop.classList.add('closing');

            // Wait for animation to complete before hiding
            setTimeout(() => {
                modal.style.display = 'none';
                document.body.style.overflow = '';

                // Remove closing classes for next open
                if (modalContent) modalContent.classList.remove('closing');
                if (modalBackdrop) modalBackdrop.classList.remove('closing');

                // Pause audio when closing
                const audio = document.getElementById('modal-audio');
                if (audio) {
                    audio.pause();
                    audio.currentTime = 0;
                }
            }, 350); // Match the macOS animation duration
        }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.style.display === 'flex') {
            closeModal();
        }
    });

    // Modal Tab Switching
    const modalTabs = document.querySelectorAll('.modal-tab');
    modalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            // Update active tab button
            modalTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active tab content
            const tabContents = document.querySelectorAll('.tab-content');
            tabContents.forEach(content => {
                content.classList.remove('active');
            });

            const activeContent = document.getElementById(`tab-${tabName}`);
            if (activeContent) {
                activeContent.classList.add('active');
            }
        });
    });
});

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? 'fa-check' : 'fa-exclamation-triangle';

    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fa-solid ${icon}"></i>
        </div>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================
// Filename Popup - Simple Overlay
// ============================================
window.showFilenamePopup = function (filename, event) {
    // Remove any existing popup
    closeFilenamePopup();

    // Create simple overlay
    const overlay = document.createElement('div');
    overlay.className = 'filename-overlay';
    overlay.innerHTML = `
        <span class="filename-overlay-text">${escapeHtml(filename)}</span>
        <button class="filename-overlay-close" onclick="closeFilenamePopup()">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    document.body.appendChild(overlay);

    // Position near the click
    if (event) {
        const rect = event.target.getBoundingClientRect();
        overlay.style.top = `${rect.bottom + 8}px`;
        overlay.style.left = `${Math.max(10, rect.left)}px`;
    }

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', closeFilenamePopupOnOutside);
    }, 10);

    // Close on ESC
    document.addEventListener('keydown', closeFilenamePopupOnEsc);
};

function closeFilenamePopupOnOutside(e) {
    const overlay = document.querySelector('.filename-overlay');
    if (overlay && !overlay.contains(e.target)) {
        closeFilenamePopup();
    }
}

function closeFilenamePopupOnEsc(e) {
    if (e.key === 'Escape') {
        closeFilenamePopup();
    }
}

window.closeFilenamePopup = function () {
    const overlay = document.querySelector('.filename-overlay');
    if (overlay) {
        overlay.remove();
    }
    document.removeEventListener('click', closeFilenamePopupOnOutside);
    document.removeEventListener('keydown', closeFilenamePopupOnEsc);
};

// ============================================
// Utility Functions
// ============================================

// Robust JSON parser that handles Markdown code blocks and extra text
function tryParseJSON(text) {
    if (!text) return null;
    if (typeof text === 'object') return text;

    let cleanText = text.trim();

    // Remove Markdown code blocks if present
    if (cleanText.includes('```')) {
        cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '');
    }

    // Try parsing
    try {
        return JSON.parse(cleanText);
    } catch (e) {
        // If simple parse fails, try extracting from { }
        try {
            const startStr = cleanText.indexOf('{');
            const endStr = cleanText.lastIndexOf('}');
            if (startStr !== -1 && endStr !== -1) {
                return JSON.parse(cleanText.substring(startStr, endStr + 1));
            }
        } catch (e2) {
            // Failed
        }
    }
    return null;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function animateCounter(element, target, suffix = '') {
    const duration = 1000;
    // Handle non-numeric content safely
    let startVal = parseInt(element.textContent);
    if (isNaN(startVal)) startVal = 0;

    const start = startVal;

    // Optimisation: If already at target, stop.
    if (start === target) {
        element.textContent = target + suffix;
        return;
    }

    const increment = (target - start) / (duration / 16);
    let current = start;

    const step = () => {
        current += increment;
        // Check if we passed the target or if increment is 0 (safety)
        if ((increment > 0 && current >= target) || (increment < 0 && current <= target)) {
            element.textContent = target + suffix;
        } else {
            element.textContent = Math.round(current) + suffix;
            requestAnimationFrame(step);
        }
    };

    requestAnimationFrame(step);
}

// ============================================
// Settings Management
// ============================================
const defaultSettings = {
    theme: 'light',
    compact: false,
    animations: true,
    emailNotify: true,
    browserNotify: false,
    sound: false,
    pageSize: '25',
    autoRefresh: '60',
    dateFormat: 'short'
};

function initializeSettings() {
    // Load saved settings
    const savedSettings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;

    // Apply theme
    applyTheme(savedSettings.theme);

    // Update UI elements
    updateSettingsUI(savedSettings);

    // Setup event listeners
    setupSettingsListeners();

    // Update settings account info
    updateSettingsAccount();
}

function applyTheme(theme) {
    const isDark = theme === 'dark';

    if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        // Actually, some styles might rely on the absence of data-theme or presence of data-theme="light"
        // Let's set it to light explicitly to be safe, or remove it if that's what's expected.
        // Based on style.css, it uses [data-theme="dark"] for overrides.
    }

    // Update Header Theme Toggle
    const themeToggle = document.getElementById('theme-toggle-checkbox');
    if (themeToggle) {
        themeToggle.checked = isDark;
    }

    // Update old theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    // Update Charts
    if (typeof initializeSentimentChart === 'function') initializeSentimentChart();
    if (typeof initializeCategoriesChart === 'function') initializeCategoriesChart();
}

function updateSettingsUI(settings) {
    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    // Toggle switches
    const compactToggle = document.getElementById('setting-compact');
    const animationsToggle = document.getElementById('setting-animations');
    const emailNotifyToggle = document.getElementById('setting-email-notify');
    const browserNotifyToggle = document.getElementById('setting-browser-notify');
    const soundToggle = document.getElementById('setting-sound');

    if (compactToggle) compactToggle.checked = settings.compact;
    if (animationsToggle) animationsToggle.checked = settings.animations;
    if (emailNotifyToggle) emailNotifyToggle.checked = settings.emailNotify;
    if (browserNotifyToggle) browserNotifyToggle.checked = settings.browserNotify;
    if (soundToggle) soundToggle.checked = settings.sound;

    // Dropdowns
    const pageSizeSelect = document.getElementById('setting-page-size');
    const autoRefreshSelect = document.getElementById('setting-auto-refresh');
    const dateFormatSelect = document.getElementById('setting-date-format');

    if (pageSizeSelect) pageSizeSelect.value = settings.pageSize;
    if (autoRefreshSelect) autoRefreshSelect.value = settings.autoRefresh;
    if (dateFormatSelect) dateFormatSelect.value = settings.dateFormat;

    // Apply animations setting
    if (!settings.animations) {
        document.body.classList.add('no-animations');
    } else {
        document.body.classList.remove('no-animations');
    }
}

function setupSettingsListeners() {
    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            applyTheme(theme);

            // Sync with settings
            const settings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;
            settings.theme = theme;
            localStorage.setItem('voxanalyze-settings', JSON.stringify(settings));
        });
    });

    // Modern Header Theme Toggle
    const headerThemeToggle = document.getElementById('theme-toggle-checkbox');
    if (headerThemeToggle) {
        headerThemeToggle.addEventListener('change', () => {
            const theme = headerThemeToggle.checked ? 'dark' : 'light';
            applyTheme(theme);

            // Sync with settings
            const settings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;
            settings.theme = theme;
            localStorage.setItem('voxanalyze-settings', JSON.stringify(settings));
        });
    }

    // Animations toggle - apply immediately
    const animationsToggle = document.getElementById('setting-animations');
    if (animationsToggle) {
        animationsToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.classList.remove('no-animations');
            } else {
                document.body.classList.add('no-animations');
            }
        });
    }

    // Save settings button
    const saveBtn = document.getElementById('save-settings');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSettings);
    }

    // Reset settings button
    const resetBtn = document.getElementById('reset-settings');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSettings);
    }

    // Settings logout button
    const settingsLogout = document.getElementById('settings-logout');
    if (settingsLogout) {
        settingsLogout.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
                await supabaseClient.auth.signOut();
            } catch (err) {
                console.error('Logout error:', err);
            }
            window.location.href = '/login';
        });
    }
}

function saveSettings() {
    const settings = {
        theme: document.querySelector('.theme-btn.active')?.dataset.theme || 'light',
        compact: document.getElementById('setting-compact')?.checked || false,
        animations: document.getElementById('setting-animations')?.checked ?? true,
        emailNotify: document.getElementById('setting-email-notify')?.checked ?? true,
        browserNotify: document.getElementById('setting-browser-notify')?.checked || false,
        sound: document.getElementById('setting-sound')?.checked || false,
        pageSize: document.getElementById('setting-page-size')?.value || '25',
        autoRefresh: document.getElementById('setting-auto-refresh')?.value || '60',
        dateFormat: document.getElementById('setting-date-format')?.value || 'short'
    };

    localStorage.setItem('voxanalyze-settings', JSON.stringify(settings));
    showToast('Settings saved successfully!', 'success');
}

function resetSettings() {
    localStorage.setItem('voxanalyze-settings', JSON.stringify(defaultSettings));
    updateSettingsUI(defaultSettings);
    applyTheme(defaultSettings.theme);
    showToast('Settings reset to defaults', 'success');
}

function updateSettingsAccount() {
    const settingsName = document.getElementById('settings-name');
    const settingsEmail = document.getElementById('settings-email');
    const settingsAvatar = document.getElementById('settings-avatar');

    // Get user info from main profile
    const userName = document.getElementById('user-name')?.textContent || 'User';
    const userEmail = document.getElementById('user-email')?.textContent || '';

    if (settingsName) settingsName.textContent = userName;
    if (settingsEmail) settingsEmail.textContent = userEmail;
    if (settingsAvatar) {
        settingsAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=6366f1&color=fff&size=80`;
    }
}

// Initialize settings when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Load theme immediately to prevent flash
    const savedSettings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;
    applyTheme(savedSettings.theme);
});

// Full settings init after main content loads
window.addEventListener('load', () => {
    initializeSettings();
});

// ============================================
// Summary Modal Functions
// ============================================

let currentSummaryCallId = null;

function openSummaryModal(callId) {
    const call = allCalls.find(c => c.id == callId);
    if (!call) {
        showToast('Call not found', 'error');
        return;
    }

    currentSummaryCallId = callId;

    // Update modal content
    const filenameEl = document.getElementById('summary-modal-filename');
    const contentEl = document.getElementById('summary-modal-content');
    const modal = document.getElementById('summary-modal');

    if (filenameEl) filenameEl.textContent = call.filename || 'Unknown';

    // Parse and display summary
    if (contentEl) {
        const summaryText = call.summary || 'No summary available';
        let summaryData = null;

        try {
            summaryData = JSON.parse(summaryText);
        } catch (e) {
            // Not JSON, display as plain text
            contentEl.innerHTML = `<p>${escapeHtml(summaryText)}</p>`;
        }

        if (summaryData && typeof summaryData === 'object') {
            let html = '';

            // Overview
            if (summaryData.overview) {
                html += `
                    <div class="summary-section">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-circle-info"></i> Overview
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary); text-align: justify;">${escapeHtml(summaryData.overview)}</p>
                    </div>
                `;
            }

            // Detected Speakers (New)
            if (summaryData.detected_speakers && typeof summaryData.detected_speakers === 'object') {
                const speakersHtml = Object.entries(summaryData.detected_speakers)
                    .map(([label, role]) => `
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                            <span style="font-size: 11px; padding: 2px 6px; background: rgba(99, 102, 241, 0.1); color: var(--accent-primary); border-radius: 4px; font-weight: 600;">${escapeHtml(label)}</span>
                            <span style="color: var(--text-primary); font-weight: 500;">${escapeHtml(role)}</span>
                        </div>
                    `).join('');

                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-users"></i> Identified Speakers
                        </h4>
                        <div style="padding-left: 4px;">${speakersHtml}</div>
                    </div>
                `;
            }

            // Caller Intent
            if (summaryData.caller_intent) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-crosshairs"></i> Caller Intent
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary);">${escapeHtml(summaryData.caller_intent)}</p>
                    </div>
                `;
            }

            // Issue Details
            if (summaryData.issue_details) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-magnifying-glass-triangle"></i> Issue Details
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary);">${escapeHtml(summaryData.issue_details)}</p>
                    </div>
                `;
            }

            // Resolution
            if (summaryData.resolution) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-check-to-slot"></i> Resolution
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary);">${escapeHtml(summaryData.resolution)}</p>
                    </div>
                `;
            }

            // Key Points
            if (summaryData.key_points && Array.isArray(summaryData.key_points) && summaryData.key_points.length > 0) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-list-ul"></i> Key Points
                        </h4>
                        <ul style="margin: 0; padding-left: 20px; color: var(--text-primary);">
                            ${summaryData.key_points.map(point => `<li style="margin-bottom: 8px; line-height: 1.5;">${escapeHtml(point)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Action Items
            if (summaryData.action_items && Array.isArray(summaryData.action_items) && summaryData.action_items.length > 0) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--warning); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-clipboard-check"></i> Action Items
                        </h4>
                        <ul style="margin: 0; padding-left: 20px; color: var(--text-primary);">
                            ${summaryData.action_items.map(item => `<li style="margin-bottom: 8px; line-height: 1.5;">${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Tone
            if (summaryData.tone) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--text-secondary); margin: 0 0 8px 0; font-size: 0.95rem; font-weight: 600;">
                            Tone:
                        </h4>
                        <p style="margin: 0; color: var(--text-primary);">${escapeHtml(summaryData.tone)}</p>
                    </div>
                `;
            }

            contentEl.innerHTML = html || '<p style="color: var(--text-muted);">No detailed summary available</p>';
        }
    }

    // Setup "View Full Details" button
    const detailsBtn = document.getElementById('btn-view-full-details');
    if (detailsBtn) {
        detailsBtn.onclick = () => {
            closeSummaryModal();
            setTimeout(() => openModal(callId), 300);
        };
    }

    // Show modal
    if (modal) modal.style.display = 'flex';
}

function closeSummaryModal() {
    const modal = document.getElementById('summary-modal');
    if (modal) modal.style.display = 'none';
    currentSummaryCallId = null;
}

// Close on overlay click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('summary-modal');
    if (e.target === modal) {
        closeSummaryModal();
    }
});

// ============================================
// Minutes Translation Functions
// ============================================



// Translation maps for UI labels
const uiTranslations = {
    'en': {
        title: 'Minutes of Meeting',
        summaryTitle: 'AI Summary',
        date: 'Date:',
        time: 'Time:',
        duration: 'Duration:',
        attendees: 'Attendees:',
        subject: 'Subject:',
        opening: 'Overview',
        keyPoints: 'Key Points',
        callerIntent: 'What the Caller Wanted',
        issues: 'Issue / Topic',
        resolution: 'Resolution / Outcome',
        actionItems: 'Next Steps / Action Items',
        tone: 'Conversation Tone',
        notSpecified: '[Not specified]',
        participant: 'participant',
        participants: 'participants',
        namesNotSpecified: 'names not specified',
        minute: 'minute',
        minutes: 'minutes',
        second: 'second',
        seconds: 'seconds'
    },
    'ml': {
        title: 'മീറ്റിംഗിന്റെ മിനിട്ടുകൾ',
        summaryTitle: 'AI സംഗ്രഹം',
        date: 'തീയതി:',
        time: 'സമയം:',
        duration: 'ദൈർഘ്യം:',
        attendees: 'പങ്കെടുക്കുന്നവർ:',
        subject: 'വിഷയം:',
        opening: 'ആരംഭവും സന്ദർഭവും:',
        keyPoints: 'പ്രധാന പോയിന്റുകൾ:',
        callerIntent: 'വിളിച്ചതിന്റെ ഉദ്ദേശ്യം:',
        issues: 'പ്രശ്നം / വിഷയം:',
        resolution: 'പരിഹാരം / ഫലം:',
        actionItems: 'അടുത്ത ഘട്ടങ്ങൾ:',
        tone: 'സംഭാഷണ രീതി:',
        notSpecified: '[വ്യക്തമാക്കിയിട്ടില്ല]',
        participant: 'പങ്കാളി',
        participants: 'പങ്കാളികൾ',
        namesNotSpecified: 'പേരുകൾ വ്യക്തമാക്കിയിട്ടില്ല',
        minute: 'മിനിറ്റ്',
        minutes: 'മിനിറ്റ്',
        second: 'സെക്കൻഡ്',
        seconds: 'സെക്കൻഡ്'
    },
    'hi': {
        title: 'बैठक की कार्यवृत्त',
        summaryTitle: 'AI सारांश',
        date: 'तारीख:',
        time: 'समय:',
        duration: 'अवधि:',
        attendees: 'उपस्थित:',
        subject: 'विषय:',
        opening: 'शुरुआत और संदर्भ:',
        keyPoints: 'मुख्य चर्चा बिंदु:',
        callerIntent: 'कॉल करने का इरादा:',
        issues: 'समस्या / विषय:',
        resolution: 'समाधान / परिणाम:',
        actionItems: 'अगले कदम:',
        tone: 'बातचीत का माहौल:',
        notSpecified: '[निर्दिष्ट नहीं]',
        participant: 'प्रतिभागी',
        participants: 'प्रतिभागियों',
        namesNotSpecified: 'नाम निर्दिष्ट नहीं',
        minute: 'मिनट',
        minutes: 'मिनट',
        second: 'सेकंड',
        seconds: 'सेकंड'
    },
    'ar': {
        title: 'محضر الاجتماع',
        summaryTitle: 'ملخص الذكاء الاصطناعي',
        date: 'التاريخ:',
        time: 'الوقت:',
        duration: 'المدة:',
        attendees: 'الحضور:',
        subject: 'الموضوع:',
        opening: 'الافتتاح والسياق:',
        keyPoints: 'نقاط النقاش الرئيسية:',
        callerIntent: 'غرض المتصل:',
        issues: 'المشكلة / الموضوع:',
        resolution: 'الحل / النتيجة:',
        actionItems: 'الخطوات التالية:',
        tone: 'نبرة الحديث:',
        notSpecified: '[غير محدد]',
        participant: 'مشارك',
        participants: 'مشاركون',
        namesNotSpecified: 'الأسماء غير محددة',
        minute: 'دقيقة',
        minutes: 'دقائق',
        second: 'ثانية',
        seconds: 'ثواني'
    }
};

function getLanguageName(code) {
    const names = {
        'en': 'English',
        'ml': 'Malayalam',
        'hi': 'Hindi',
        'ar': 'Arabic'
    };
    return names[code] || code;
}

function getUITranslations(language) {
    return uiTranslations[language] || uiTranslations['en'];
}

function updateMinutesWithTranslation(callId, translatedText, language) {
    const call = allCalls.find(c => c.id == callId);
    if (!call) return;

    // Get UI translations for selected language
    const ui = getUITranslations(language);

    // Parse translated text as JSON if possible
    const translatedData = tryParseJSON(translatedText);

    const modalMinutes = document.getElementById('modal-minutes');
    if (!modalMinutes) return;

    // Rebuild minutes HTML with FULL STRUCTURE and translated content
    let minutesHtml = '<div class="meeting-minutes">';

    // Header with translation button
    minutesHtml += '<div class="minutes-header">';
    minutesHtml += `<h5 class="minutes-title">${ui.title}</h5>`;
    minutesHtml += `
        <div class="minutes-translate-dropdown">
            <button class="minutes-translate-btn" onclick="toggleMinutesTranslate(event)">
                <i class="fa-solid fa-language"></i>
                <span>Translate</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="minutes-translate-menu" id="minutes-translate-menu">
                <button class="translate-option" onclick="translateMinutes(${callId}, 'en', event)">
                    <span class="lang-flag">🇬🇧</span>
                    English
                </button>
                <button class="translate-option" onclick="translateMinutes(${callId}, 'ml', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Malayalam
                </button>
                <button class="translate-option" onclick="translateMinutes(${callId}, 'hi', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Hindi
                </button>
                <button class="translate-option" onclick="translateMinutes(${callId}, 'ar', event)">
                    <span class="lang-flag">🇸🇦</span>
                    Arabic
                </button>
            </div>
        </div>
    `;
    minutesHtml += '</div>';

    // Date and Time section (keep original structure)
    minutesHtml += '<div class="minutes-meta">';

    // Safe summary parsing
    const originalData = (typeof call.summary === 'object' && call.summary !== null)
        ? call.summary
        : (tryParseJSON(call.summary) || {});

    // Date
    let meetingDate = ui.notSpecified;
    if (originalData && originalData.meeting_date) {
        meetingDate = originalData.meeting_date;
    } else if (originalData && originalData.date) {
        meetingDate = originalData.date;
    }
    // Check for null or empty values
    if (!meetingDate || meetingDate === 'null' || meetingDate === 'NULL' || meetingDate.trim() === '') {
        meetingDate = ui.notSpecified;
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.date}</span>
            <span class="minutes-value">${escapeHtml(meetingDate)}</span>
        </div>
    `;

    // Time
    let meetingTime = ui.notSpecified;
    if (originalData && originalData.meeting_time) {
        meetingTime = originalData.meeting_time;
    } else if (originalData && originalData.time) {
        meetingTime = originalData.time;
    }
    // Check for null or empty values
    if (!meetingTime || meetingTime === 'null' || meetingTime === 'NULL' || meetingTime.trim() === '') {
        meetingTime = ui.notSpecified;
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.time}</span>
            <span class="minutes-value">${escapeHtml(meetingTime)}</span>
        </div>
    `;

    // Duration
    let durationText = ui.notSpecified;
    if (call.duration && call.duration > 0) {
        const minutes = Math.floor(call.duration / 60);
        const seconds = call.duration % 60;
        if (minutes > 0) {
            durationText = `${minutes} ${minutes !== 1 ? ui.minutes : ui.minute}`;
            if (seconds > 0) {
                durationText += ` ${seconds} ${seconds !== 1 ? ui.seconds : ui.second}`;
            }
        } else {
            durationText = `${seconds} ${seconds !== 1 ? ui.seconds : ui.second}`;
        }
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.duration}</span>
            <span class="minutes-value">${escapeHtml(durationText)}</span>
        </div>
    `;
    minutesHtml += '</div>'; // End minutes-meta

    // Attendees section
    minutesHtml += '<div class="minutes-section">';
    minutesHtml += `<h6><i class="fa-solid fa-users"></i> ${ui.attendees}</h6>`;

    const diarizationData = call.diarization_data || [];
    const speakerCount = call.speaker_count || 0;

    if (speakerCount > 0 || diarizationData.length > 0) {
        const uniqueSpeakers = new Set();
        const speakerMap = {};
        let speakerIndex = 1;

        diarizationData.forEach(utterance => {
            const originalSpeaker = utterance.speaker || 'Unknown';
            let displayName = utterance.display_name;
            if (!displayName) {
                if (!speakerMap[originalSpeaker]) {
                    speakerMap[originalSpeaker] = `Speaker ${speakerIndex}`;
                    speakerIndex++;
                }
                displayName = speakerMap[originalSpeaker];
            }
            uniqueSpeakers.add(displayName);
        });

        if (uniqueSpeakers.size > 0) {
            minutesHtml += '<ul class="attendees-list">';
            uniqueSpeakers.forEach(speaker => {
                minutesHtml += `<li>${escapeHtml(speaker)}</li>`;
            });
            minutesHtml += '</ul>';
        } else {
            minutesHtml += `<p class="minutes-placeholder">${speakerCount} ${speakerCount !== 1 ? ui.participants : ui.participant} (${ui.namesNotSpecified})</p>`;
        }
    } else {
        minutesHtml += `<p class="minutes-placeholder">${ui.notSpecified}</p>`;
    }
    minutesHtml += '</div>';

    // Subject section (translated) - use label-value format
    minutesHtml += '<div class="minutes-meta">';

    let subject = ui.notSpecified;
    if (translatedData) {
        if (translatedData.caller_intent) {
            subject = translatedData.caller_intent;
        } else if (translatedData.overview) {
            const overview = translatedData.overview;
            subject = overview.split('.')[0] || overview.substring(0, 100);
        }
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.subject}</span>
            <span class="minutes-value">${escapeHtml(subject)}</span>
        </div>
    `;
    minutesHtml += '</div>';

    // TRANSLATED CONTENT - Structured format with labels
    if (translatedData && typeof translatedData === 'object') {
        // Create a content sections container
        minutesHtml += '<div class="minutes-content-sections">';

        // 1. Overview / Opening
        if (translatedData.overview) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.opening}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.overview)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        // 2. Key Discussion Points - show as list with label
        if (translatedData.key_points && translatedData.key_points.length > 0) {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += `<h6><i class="fa-solid fa-list-ol"></i> ${ui.keyPoints}</h6>`;
            minutesHtml += '<ol class="minutes-points-list">';
            translatedData.key_points.forEach(point => {
                minutesHtml += `<li>${escapeHtml(point)}</li>`;
            });
            minutesHtml += '</ol>';
            minutesHtml += '</div>';
        }

        // 3. Issue Identification - label-value format
        if (translatedData.issue_details) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.issues}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.issue_details)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        // 4. Resolution / Outcome - label-value format
        if (translatedData.resolution) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.resolution}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.resolution)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        // 5. Action Items / Next Steps - show as list with label
        if (translatedData.action_items && translatedData.action_items.length > 0) {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += `<h6><i class="fa-solid fa-tasks"></i> ${ui.actionItems}</h6>`;
            minutesHtml += '<ul class="minutes-action-list">';
            translatedData.action_items.forEach(item => {
                minutesHtml += `<li>${escapeHtml(item)}</li>`;
            });
            minutesHtml += '</ul>';
            minutesHtml += '</div>';
        }

        // 6. Tone - label-value format
        if (translatedData.tone) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.tone}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.tone)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        minutesHtml += '</div>'; // End minutes-content-sections
    } else {
        // Display as plain text if not structured
        minutesHtml += '<div class="minutes-section">';
        minutesHtml += '<h6><i class="fa-solid fa-language"></i> Translated Content:</h6>';
        minutesHtml += `<p>${escapeHtml(translatedText)}</p>`;
        minutesHtml += '</div>';
    }

    minutesHtml += '</div>'; // End meeting-minutes
    modalMinutes.innerHTML = minutesHtml;
}



// ============================================
// Summary Translation Functions
// ============================================

function toggleSummaryTranslate(event) {
    event.stopPropagation();
    const menu = document.getElementById('summary-translate-menu');
    if (menu) {
        menu.classList.toggle('active');
    }
}

async function translateSummary(callId, language, event) {
    event.stopPropagation();

    // Close dropdown
    const menu = document.getElementById('summary-translate-menu');
    if (menu) menu.classList.remove('active');

    const call = allCalls.find(c => c.id == callId);
    if (!call) {
        showToast('Call not found', 'error');
        return;
    }

    // Show persistent loading indicator in modal
    const modalSummary = document.getElementById('modal-summary');
    if (modalSummary) {
        modalSummary.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 80px 40px;
                gap: 24px;
                background: linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%);
                border-radius: 16px;
                position: relative;
                overflow: hidden;
            ">
                <!-- Animated background gradient -->
                <div style="
                    position: absolute;
                    top: -50%;
                    left: -50%;
                    width: 200%;
                    height: 200%;
                    background: radial-gradient(circle, rgba(99, 102, 241, 0.1) 0%, transparent 70%);
                    animation: rotate 8s linear infinite;
                "></div>
                
                <!-- Floating particles -->
                <div style="
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    top: 0;
                    left: 0;
                    overflow: hidden;
                ">
                    <div style="position: absolute; top: 20%; left: 10%; width: 4px; height: 4px; background: rgba(99, 102, 241, 0.4); border-radius: 50%; animation: float 3s ease-in-out infinite;"></div>
                    <div style="position: absolute; top: 60%; left: 80%; width: 6px; height: 6px; background: rgba(168, 85, 247, 0.4); border-radius: 50%; animation: float 4s ease-in-out infinite 1s;"></div>
                    <div style="position: absolute; top: 40%; left: 70%; width: 3px; height: 3px; background: rgba(99, 102, 241, 0.3); border-radius: 50%; animation: float 5s ease-in-out infinite 2s;"></div>
                </div>
                
                <!-- Main icon container -->
                <div style="
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 80px;
                    height: 80px;
                    background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
                    border-radius: 20px;
                    box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3), 0 0 0 0 rgba(99, 102, 241, 0.4);
                    animation: pulse-ring 2s ease-in-out infinite;
                ">
                    <i class="fa-solid fa-language" style="
                        color: white;
                        font-size: 36px;
                        animation: bounce-subtle 2s ease-in-out infinite;
                    "></i>
                </div>
                
                <!-- Text content -->
                <div style="position: relative; text-align: center; z-index: 1;">
                    <p style="
                        font-size: 20px;
                        font-weight: 700;
                        color: var(--text-primary);
                        margin: 0 0 8px 0;
                        letter-spacing: -0.02em;
                    ">Translating to ${getLanguageName(language)}</p>
                    
                    <!-- Animated dots -->
                    <div style="display: flex; justify-content: center; gap: 6px; margin-bottom: 12px;">
                        <div style="width: 8px; height: 8px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 50%; animation: dot-bounce 1.4s ease-in-out infinite;"></div>
                        <div style="width: 8px; height: 8px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 50%; animation: dot-bounce 1.4s ease-in-out infinite 0.2s;"></div>
                        <div style="width: 8px; height: 8px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 50%; animation: dot-bounce 1.4s ease-in-out infinite 0.4s;"></div>
                    </div>
                    
                    <p style="
                        font-size: 14px;
                        color: var(--text-secondary);
                        margin: 0;
                        font-weight: 500;
                    ">This may take a few moments</p>
                </div>
                
                <!-- Progress bar -->
                <div style="
                    width: 200px;
                    height: 4px;
                    background: rgba(99, 102, 241, 0.1);
                    border-radius: 2px;
                    overflow: hidden;
                    position: relative;
                    z-index: 1;
                ">
                    <div style="
                        width: 100%;
                        height: 100%;
                        background: linear-gradient(90deg, #6366f1, #a855f7, #6366f1);
                        background-size: 200% 100%;
                        animation: shimmer 2s linear infinite;
                    "></div>
                </div>
            </div>
            
            <style>
                @keyframes pulse-ring {
                    0%, 100% {
                        box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3), 0 0 0 0 rgba(99, 102, 241, 0.4);
                    }
                    50% {
                        box-shadow: 0 8px 32px rgba(99, 102, 241, 0.4), 0 0 0 20px rgba(99, 102, 241, 0);
                    }
                }
                
                @keyframes bounce-subtle {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                }
                
                @keyframes rotate {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                @keyframes float {
                    0%, 100% { transform: translateY(0); opacity: 0.3; }
                    50% { transform: translateY(-20px); opacity: 0.8; }
                }
                
                @keyframes dot-bounce {
                    0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
                    40% { transform: scale(1); opacity: 1; }
                }
                
                @keyframes shimmer {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                }
            </style>
        `;
    }

    try {
        // Ensure summaryText is a string (FastAPI expects str for transcript field)
        const summaryText = typeof call.summary === 'object' ? JSON.stringify(call.summary) : (call.summary || '');

        // Prepare request payload
        const requestData = {
            transcript: summaryText,
            language: language,
            diarization_data: []
        };

        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error('Translation failed');
        }

        const result = await response.json();

        if (result.success && result.translated_text) {
            // Update the summary display with translated content
            updateSummaryWithTranslation(callId, result.translated_text, language);
            showToast(`Translated to ${getLanguageName(language)}!`, 'success');
        } else {
            // Restore original content on error
            const call = allCalls.find(c => c.id == callId);
            if (call) {
                openModal(callId); // Refresh modal to show original content
            }
            showToast('Translation failed. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Translation error:', error);
        // Restore original content on error
        const call = allCalls.find(c => c.id == callId);
        if (call) {
            openModal(callId); // Refresh modal to show original content
        }
        showToast('Translation failed. Please try again.', 'error');
    }
}

function updateSummaryWithTranslation(callId, translatedText, language) {
    const call = allCalls.find(c => c.id == callId);
    if (!call) return;

    // Get UI translations for selected language
    const ui = getUITranslations(language);

    // Parse translated text as JSON if possible
    const translatedData = tryParseJSON(translatedText);

    const modalSummary = document.getElementById('modal-summary');
    if (!modalSummary) return;

    // Build translated summary HTML
    let summaryHtml = '<div class="structured-summary">';

    // Add translation header
    summaryHtml += '<div class="summary-translate-header">';
    summaryHtml += `<h4 class="summary-main-title"><i class="fa-solid fa-brain" style="margin-right: 8px; color: var(--accent-primary);"></i> ${ui.summaryTitle || 'AI Summary'}</h4>`;
    summaryHtml += `
        <div class="summary-translate-dropdown">
            <button class="summary-translate-btn" onclick="toggleSummaryTranslate(event)">
                <i class="fa-solid fa-language"></i>
                <span>Translate</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="summary-translate-menu" id="summary-translate-menu">
                <button class="translate-option" onclick="translateSummary(${callId}, 'en', event)">
                    <span class="lang-flag">🇬🇧</span>
                    English
                </button>
                <button class="translate-option" onclick="translateSummary(${callId}, 'ml', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Malayalam
                </button>
                <button class="translate-option" onclick="translateSummary(${callId}, 'hi', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Hindi
                </button>
                <button class="translate-option" onclick="translateSummary(${callId}, 'ar', event)">
                    <span class="lang-flag">🇸🇦</span>
                    Arabic
                </button>
            </div>
        </div>
    `;
    summaryHtml += '</div>';

    if (translatedData && typeof translatedData === 'object') {
        // Overview section
        if (translatedData.overview) {
            summaryHtml += `
                <div class="summary-section overview-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-lightbulb"></i>
                        <strong>${ui.opening || 'Overview'}</strong>
                    </div>
                    <p class="summary-overview">${escapeHtml(translatedData.overview)}</p>
                </div>
            `;
        }

        // Key Points section
        if (translatedData.key_points && translatedData.key_points.length > 0) {
            summaryHtml += `
                <div class="summary-section key-points-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-list-check"></i>
                        <strong>${ui.keyPoints || 'Key Points'}</strong>
                    </div>
                    <ul class="key-points-list">
                        ${translatedData.key_points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Caller Intent section
        if (translatedData.caller_intent) {
            summaryHtml += `
                <div class="summary-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-bullseye"></i>
                        <strong>${ui.callerIntent || 'What the Caller Wanted'}</strong>
                    </div>
                    <p>${escapeHtml(translatedData.caller_intent)}</p>
                </div>
            `;
        }

        // Issue Details section
        if (translatedData.issue_details) {
            summaryHtml += `
                <div class="summary-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-exclamation-circle"></i>
                        <strong>${ui.issues || 'Issue / Topic'}</strong>
                    </div>
                    <p>${escapeHtml(translatedData.issue_details)}</p>
                </div>
            `;
        }

        // Resolution section
        if (translatedData.resolution) {
            summaryHtml += `
                <div class="summary-section resolution-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-check-circle"></i>
                        <strong>${ui.resolution || 'Resolution / Outcome'}</strong>
                    </div>
                    <p>${escapeHtml(translatedData.resolution)}</p>
                </div>
            `;
        }

        // Action Items section
        if (translatedData.action_items && translatedData.action_items.length > 0) {
            summaryHtml += `
                <div class="summary-section action-items-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-tasks"></i>
                        <strong>${ui.actionItems || 'Next Steps / Action Items'}</strong>
                    </div>
                    <ul class="action-items-list">
                        ${translatedData.action_items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Tone section
        if (translatedData.tone) {
            const toneClass = getToneClass(translatedData.tone);
            summaryHtml += `
                <div class="summary-section tone-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-comment"></i>
                        <strong>${ui.tone || 'Conversation Tone'}</strong>
                    </div>
                    <span class="tone-badge ${toneClass}">${escapeHtml(translatedData.tone)}</span>
                </div>
            `;
        }
    } else {
        // Display as plain text
        summaryHtml += `<p>${escapeHtml(translatedText)}</p>`;
    }

    summaryHtml += '</div>';
    modalSummary.innerHTML = summaryHtml;
}

// Close summary translation dropdown when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('summary-translate-menu');
    if (menu && !e.target.closest('.summary-translate-dropdown')) {
        menu.classList.remove('active');
    }
});

// ============================================
// Theme Toggle Logic
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const themeCheckbox = document.getElementById('theme-toggle-checkbox');
    const savedTheme = localStorage.getItem('theme') || 'light';

    // Initial set
    setTheme(savedTheme);

    if (themeCheckbox) {
        themeCheckbox.addEventListener('change', () => {
            const newTheme = themeCheckbox.checked ? 'dark' : 'light';
            setTheme(newTheme, true);
        });
    }

    function setTheme(theme, forceReload = false) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        // Update checkbox state
        if (themeCheckbox) {
            themeCheckbox.checked = (theme === 'dark');
        }

        // Re-initialize charts with new theme colors
        if (typeof initializeSentimentChart === 'function') {
            initializeSentimentChart();
        }
        if (typeof initializeCategoriesChart === 'function') {
            initializeCategoriesChart();
        }

        // Update Vapi Widget Theme if it exists
        const oldWidget = document.querySelector('vapi-widget');
        if (oldWidget) {
            // Set attributes on the existing widget (or the one to be cloned)
            oldWidget.setAttribute('theme', theme);
            if (theme === 'dark') {
                oldWidget.setAttribute('button-base-color', '#6366f1');
                oldWidget.setAttribute('base-color', '#0f172a');
                oldWidget.setAttribute('accent-color', '#818cf8');
            } else {
                oldWidget.setAttribute('button-base-color', '#3F0067');
                oldWidget.setAttribute('base-color', '#ffffff');
                oldWidget.setAttribute('accent-color', '#9344B3');
            }

            // Force reload widget if requested (user toggle) to ensure re-render
            if (forceReload && window.initializeVapiEvents) {
                console.log('[Theme] Force reloading Vapi widget for theme change...');
                const newWidget = oldWidget.cloneNode(true);
                oldWidget.parentNode.replaceChild(newWidget, oldWidget);
                window.initializeVapiEvents(newWidget);
            }
        }
    }
});

// ============================================
// Search Functionality
// ============================================

function setupSearchListener() {
    const searchInput = document.getElementById('call-search-input');
    if (searchInput) {
        // Clear value on load
        searchInput.value = '';
        currentSearchTerm = '';

        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.trim().toLowerCase();
            applyFilters();
        });
    }
}

function applyFilters() {
    if (!Array.isArray(allCalls)) {
        console.error('[ERROR] applyFilters: allCalls is not an array:', allCalls);
        allCalls = [];
    }

    let filtered = allCalls.filter(call => {
        // Search Filter
        if (currentSearchTerm) {
            const matchesSearch = (call.filename && call.filename.toLowerCase().includes(currentSearchTerm)) ||
                (call.transcript && call.transcript.toLowerCase().includes(currentSearchTerm)) ||
                (call.summary && call.summary.toLowerCase().includes(currentSearchTerm)) ||
                (call.tags && Array.isArray(call.tags) && call.tags.some(t => t.toLowerCase().includes(currentSearchTerm)));

            if (!matchesSearch) return false;
        }

        // Sentiment Filter
        const sentiment = (call.sentiment || 'neutral').toLowerCase();
        if (!currentFilters.sentiments.includes(sentiment)) return false;

        // Tags Filter - Improved: Only filter out if call has tags AND those tags are in our known list but not selected
        if (currentFilters.tags.length > 0) {
            const callTags = call.tags || [];
            if (callTags.length > 0) {
                // Get list of tags that ARE in our filter options
                const knownFilterTags = ['Right Party Contact', 'PTP', 'Refusal', 'Dispute', 'Wrong Number', 'Callback Requested', 'Support', 'Billing'];
                const categorizableTags = callTags.filter(tag => knownFilterTags.includes(tag));

                // If the call has any tags we know about, at least one must be selected
                if (categorizableTags.length > 0) {
                    const hasMatchingTag = categorizableTags.some(tag => currentFilters.tags.includes(tag));
                    if (!hasMatchingTag) return false;
                }
                // If it only has "unknown" tags, we show it (don't hide data)
            }
        }

        // Date Filter
        if (call.created_at) {
            const callDate = new Date(call.created_at);
            if (currentFilters.dateFrom) {
                const fromDate = new Date(currentFilters.dateFrom);
                fromDate.setHours(0, 0, 0, 0);
                if (callDate < fromDate) return false;
            }
            if (currentFilters.dateTo) {
                const toDate = new Date(currentFilters.dateTo);
                toDate.setHours(23, 59, 59, 999);
                if (callDate > toDate) return false;
            }
        }

        return true;
    });

    renderTable(filtered);
}

// ============================================
// Load More Button
// ============================================
function initializeLoadMoreButton() {
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', loadMoreCalls);
    }
}

async function loadMoreCalls() {
    await fetchCalls(true);
}

// Helper for safely parsing JSON
function tryParseJSON(str) {
    if (!str) return null;
    try {
        return JSON.parse(str);
    } catch (e) {
        return null; // Return null if parsing fails
    }
}
