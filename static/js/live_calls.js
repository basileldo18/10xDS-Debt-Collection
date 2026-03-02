
document.addEventListener('DOMContentLoaded', () => {
    const liveCallsTableBody = document.getElementById('live-calls-table-body');
    const refreshBtn = document.getElementById('refresh-live-calls');
    const liveModal = document.getElementById('live-transcript-modal');
    const modalCloseBtn = document.getElementById('close-live-modal');
    const modalCloseBtnTop = document.getElementById('close-live-modal-top');
    const liveTranscriptContainer = document.getElementById('live-transcript-container');
    const connectionStatus = document.getElementById('live-connection-status');

    let activeSubscription = null;
    let currentCallId = null;
    let durationTimer = null;
    let callStartTime = null;

    // --- Sidebar Navigation for Live Calls ---
    const liveNavLink = document.getElementById('nav-live-calls');
    if (liveNavLink) {
        liveNavLink.addEventListener('click', (e) => {
            // Navigation handled by main.js
            window.fetchLiveCalls();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => window.fetchLiveCalls());
    }

    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => window.closeLiveModal());
    }
    if (modalCloseBtnTop) {
        modalCloseBtnTop.addEventListener('click', () => window.closeLiveModal());
    }

    // --- Fetch Live Calls ---
    window.fetchLiveCalls = async function () {
        if (!window.appSupabase) return;

        try {
            console.log('[Live] Fetching calls...');

            // Fetch ONLY active calls (in-progress or started)
            const { data, error } = await window.appSupabase
                .from('vapi_calls')
                .select('*')
                .in('status', ['in-progress', 'started'])
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[Live] Supabase error:', error);
                throw error;
            }

            liveCallsTableBody.innerHTML = '';

            if (!data || data.length === 0) {
                liveCallsTableBody.innerHTML = `
                    <tr>
                        <td colspan="4">
                            <div class="live-empty-state">
                                <div class="live-empty-icon">
                                    <i class="fa-solid fa-phone-slash" style="color: #6366f1; font-size: 1.3rem;"></i>
                                </div>
                                <div>
                                    <p style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin: 0 0 5px;">No Active Calls</p>
                                    <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0; max-width: 300px;">All agents are currently idle. Live calls will appear here automatically.</p>
                                </div>
                            </div>
                        </td>
                    </tr>`;
                return;
            }

            console.log(`[Live] Found ${data.length} calls.`);

            data.forEach(call => {
                const row = document.createElement('tr');

                const isLive = call.status === 'in-progress' || call.status === 'started';
                const isEnded = call.status === 'ended';

                let statusColor = '#64748b'; // Default gray
                let statusLabel = (call.status || 'Unknown').charAt(0).toUpperCase() + (call.status || 'unknown').slice(1);
                let badgeClass = '';

                if (isLive) {
                    statusColor = '#22c55e'; // Green
                    statusLabel = 'Live';
                    badgeClass = 'pulse';
                } else if (isEnded) {
                    statusColor = '#94a3b8'; // Lighter gray
                }

                row.innerHTML = `
                    <td>
                        ${isLive
                        ? `<span class="live-badge"><span class="live-dot"></span>Live</span>`
                        : `<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;font-weight:600;color:#94a3b8;"><i class="fa-solid fa-circle" style="font-size:6px;"></i>${statusLabel}</span>`
                    }
                    </td>
                    <td>
                        <span class="live-call-id">${call.call_id ? call.call_id.substring(0, 12) + '...' : 'Unknown'}</span>
                    </td>
                    <td style="color: var(--text-secondary); font-size: 0.85rem;">${new Date(call.created_at).toLocaleString()}</td>
                    <td style="text-align: right;">
                        <button class="btn-live-view view-live-btn" data-id="${call.call_id}" data-started-at="${call.started_at || call.created_at}">
                            <i class="fa-solid ${isLive ? 'fa-eye' : 'fa-list-alt'}"></i>
                            ${isLive ? 'Live View' : 'Transcript'}
                        </button>
                    </td>
                `;

                // Make the entire row clickable
                row.style.cursor = 'pointer';
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.view-live-btn')) return;
                    openLiveModal(call.call_id, call.started_at || call.created_at);
                });

                liveCallsTableBody.appendChild(row);
            });

            // Attach Click Listeners
            document.querySelectorAll('.view-live-btn').forEach(btn => {
                btn.addEventListener('click', () => openLiveModal(btn.dataset.id, btn.dataset.startedAt));
            });

        } catch (err) {
            console.error('Error fetching live calls:', err);
            if (liveCallsTableBody) {
                liveCallsTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">Error: ${err.message}</td></tr>`;
            }
        } finally {
            syncSidebarBadge();
        }
    }

    function syncSidebarBadge() {
        const badge = document.getElementById('live-call-count');
        if (!badge) return;

        // Check if there are any active rows in the table
        const hasActiveCalls = !!liveCallsTableBody.querySelector('.live-badge');

        if (hasActiveCalls) {
            badge.style.display = 'inline-flex';
            badge.textContent = 'Live';
        } else {
            badge.style.display = 'none';
        }
    }

    // --- Live Transcript Modal ---
    window.openLiveModal = async function (callId, startedAt = null) {
        if (!callId) return;
        currentCallId = callId;

        console.log('[Live] Opening modal for call:', callId);

        // Show modal
        liveModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Update Call ID display
        const callIdDisplay = document.getElementById('lct-call-id-display');
        if (callIdDisplay) {
            callIdDisplay.textContent = 'Call ID: ' + (callId ? callId.substring(0, 12) + '...' : '—');
        }

        // Update Date
        const dateDisplay = document.getElementById('live-chat-date');
        if (dateDisplay) {
            const now = new Date();
            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            dateDisplay.textContent = now.toLocaleDateString('en-GB', options);
        }

        // Start duration timer
        callStartTime = startedAt ? new Date(startedAt).getTime() : Date.now();
        clearInterval(durationTimer);
        durationTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
            const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const ss = String(elapsed % 60).padStart(2, '0');
            const timerEl = document.getElementById('lct-timer-display');
            if (timerEl) timerEl.textContent = `${mm}:${ss}`;
        }, 1000);

        // Reset Status
        connectionStatus.textContent = 'Connecting...';

        // Clear previous content and show loading
        // Clear previous content
        liveTranscriptContainer.innerHTML = '';

        // 1. Fetch History
        await fetchTranscriptHistory(callId);

        // 2. Subscribe to Realtime
        subscribeToCall(callId);
    };

    window.closeLiveModal = function () {
        liveModal.style.display = 'none';
        document.body.style.overflow = '';
        currentCallId = null;
        // Stop duration timer
        clearInterval(durationTimer);
        durationTimer = null;
        const timerEl = document.getElementById('lct-timer-display');
        if (timerEl) timerEl.textContent = '00:00';
        if (activeSubscription) {
            window.appSupabase.removeChannel(activeSubscription);
            activeSubscription = null;
        }

        // Re-sync badge state in case visibility changed
        syncSidebarBadge();
    };

    // Close button in footer
    const closeBtnFooter = document.getElementById('close-live-modal-btn');
    if (closeBtnFooter) {
        closeBtnFooter.addEventListener('click', () => window.closeLiveModal());
    }

    // Copy button
    const copyBtn = document.getElementById('copy-live-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const text = Array.from(liveTranscriptContainer.querySelectorAll('.chat-msg-row'))
                .map(el => {
                    const role = el.classList.contains('sent') ? 'User' : 'Assistant';
                    const content = el.querySelector('.msg-bubble').textContent.trim();
                    return `${role}: ${content}`;
                })
                .join('\n\n');

            navigator.clipboard.writeText(text).then(() => {
                const icon = copyBtn.querySelector('i');
                if (icon) {
                    const originalClass = icon.className;
                    icon.className = 'fa-solid fa-check';
                    const originalText = copyBtn.lastChild.textContent;
                    copyBtn.lastChild.textContent = ' Copied';

                    setTimeout(() => {
                        icon.className = originalClass;
                        copyBtn.lastChild.textContent = originalText;
                    }, 2000);
                }
            }).catch(err => console.error('Failed to copy to clipboard:', err));
        });
    }

    // Close on backdrop click
    liveModal.addEventListener('click', (e) => {
        if (e.target === liveModal || e.target.classList.contains('modal-backdrop')) {
            window.closeLiveModal();
        }
    });

    async function fetchTranscriptHistory(callId) {
        // Show loading if empty and not just placeholder
        if ((!liveTranscriptContainer.hasChildNodes() || liveTranscriptContainer.innerHTML.trim() === '') && !liveTranscriptContainer.querySelector('.empty-state')) {
            liveTranscriptContainer.innerHTML = `
                <div class="empty-state">
                    <div class="loader-spinner" style="border-top-color:#9344B3; width:30px; height:30px;"></div>
                    <p>Loading conversation history...</p>
                </div>`;
        }

        const { data, error } = await window.appSupabase
            .from('transcripts')
            .select('*')
            .eq('call_id', callId)
            .order('timestamp', { ascending: true });

        if (error) {
            console.error('[Live] Error fetching history:', error);
            // Only show error if empty
            if (liveTranscriptContainer.querySelector('.empty-state')) {
                liveTranscriptContainer.innerHTML = `<div class="empty-state" style="color:red"><p>Error loading history.</p></div>`;
            }
            return;
        }

        // Remove loading state if present
        const emptyState = liveTranscriptContainer.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        if (!data || data.length === 0) {
            if (!liveTranscriptContainer.hasChildNodes()) {
                liveTranscriptContainer.innerHTML = `<div class="lct-empty-connecting"><div class="lct-typing-indicator"><span></span><span></span><span></span></div><p>No transcripts yet. Waiting for speech...</p></div>`;
            }
            return;
        }

        // Upsert messages
        data.forEach(t => upsertTranscriptToUI(t));
        scrollToBottom();
    }

    function subscribeToCall(callId) {
        if (activeSubscription) {
            window.appSupabase.removeChannel(activeSubscription);
        }

        connectionStatus.textContent = 'Connecting...';

        activeSubscription = window.appSupabase
            .channel(`live-call-${callId}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // Listen to INSERT and UPDATE (for merged turns)
                    schema: 'public',
                    table: 'transcripts',
                    filter: `call_id=eq.${callId}`
                },
                (payload) => {
                    console.log('Realtime update:', payload);
                    handleRealtimeUpdate(payload);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    connectionStatus.textContent = 'Live Connected';
                    connectionStatus.parentElement.querySelector('i').classList.add('pulse'); // Add pulse effect
                }
            });
    }

    function handleRealtimeUpdate(payload) {
        // Remove empty state if it exists
        const emptyState = document.querySelector('#live-transcript-container .empty-state');
        if (emptyState) emptyState.remove();

        const newRec = payload.new;
        if (!newRec) return;

        upsertTranscriptToUI(newRec);
        scrollToBottom();
    }

    function upsertTranscriptToUI(t) {
        const existingNode = document.getElementById(`msg-${t.id}`);

        if (existingNode) {
            // Update existing text
            const textEl = existingNode.querySelector('.msg-bubble');
            if (textEl) textEl.textContent = t.transcript;
            return;
        }

        // Before appending official DB message, remove temporary zero-latency bubbles that match
        const tempBubbles = liveTranscriptContainer.querySelectorAll('.local-temp-bubble');
        tempBubbles.forEach(tb => {
            const tempRoleClass = tb.classList.contains('sent') ? 'user' : 'assistant';
            if (tempRoleClass === t.role || (t.role === 'customer' && tempRoleClass === 'user')) {
                const tempText = tb.querySelector('.msg-bubble')?.textContent?.trim() || '';
                const incomingText = (t.transcript || '').trim();
                // If the DB text is basically the same or includes it, drop the temp bubble to prevent duplicate.
                if (tempText === incomingText || incomingText.includes(tempText) || tempText.includes(incomingText)) {
                    tb.remove();
                }
            }
        });

        // Determine role
        const isUser = t.role === 'user' || t.role === 'customer';
        const roleLabel = isUser ? 'Customer' : 'AI Agent';
        const initials = isUser ? 'US' : 'AG';

        // Format timestamp
        const ts = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        // DOM-based grouping logic
        const prevNodes = Array.from(liveTranscriptContainer.querySelectorAll('.chat-msg-row')).filter(el => !el.classList.contains('local-temp-bubble') && !el.classList.contains('interim-msg'));
        const lastRealNode = prevNodes.length > 0 ? prevNodes[prevNodes.length - 1] : null;
        let isGroupMid = false;
        if (lastRealNode) {
            const wasUser = lastRealNode.classList.contains('sent');
            if (isUser === wasUser) {
                isGroupMid = true;
            }
        }

        const div = document.createElement('div');
        div.id = `msg-${t.id}`;
        div.className = `chat-msg-row ${isUser ? 'sent' : 'received'}${isGroupMid ? ' group-mid' : ''}`;

        div.innerHTML = `
            <div class="msg-avatar-wrap">
                <div class="msg-avatar-circle">${initials}</div>
            </div>
            <div class="msg-content">
                <div class="msg-role-label">${roleLabel}</div>
                <div class="msg-bubble">${t.transcript}</div>
                ${ts ? `<div class="msg-timestamp">${ts}</div>` : ''}
            </div>
        `;

        liveTranscriptContainer.appendChild(div);
    }

    // --- Realtime Transcript Handler (From Widget/Events) ---
    window.handleRealtimeTranscript = function (detail) {
        if (!currentCallId) return; // Only process if modal is open
        // Ignore webhooks belonging to a different live call
        if (detail.call_id && detail.call_id !== currentCallId) return;

        if (!liveTranscriptContainer) return;

        const emptyState = liveTranscriptContainer.querySelector('.empty-state') || liveTranscriptContainer.querySelector('.lct-empty-connecting');
        if (emptyState) emptyState.remove();

        const role = detail.role || 'user';
        const transcriptText = detail.transcript || detail.text || '';
        if (!transcriptText || transcriptText.trim() === '') return;

        const transcriptType = detail.transcriptType || 'interim'; // 'interim' or 'final'
        const isUser = role === 'user' || role === 'customer';
        const roleLabel = isUser ? 'Customer' : 'AI Agent';
        const initials = isUser ? 'US' : 'AG';
        const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const interimId = `msg-interim-${role}`;

        if (transcriptType === 'final') {
            // Remove the interim bubble
            const existingInterim = document.getElementById(interimId);
            if (existingInterim) existingInterim.remove();

            // Group logic for temp final bubble
            const prevNodes = Array.from(liveTranscriptContainer.querySelectorAll('.chat-msg-row'));
            const lastNode = prevNodes.length > 0 ? prevNodes[prevNodes.length - 1] : null;
            let isGroupMid = false;
            if (lastNode && lastNode.classList.contains(isUser ? 'sent' : 'received')) {
                isGroupMid = true;
            }

            // Insert a temporary "local" final bubble for instant 0-latency feedback.
            // When the official Postgres refresh arrives, it will just append the real one.
            // To prevent duplicates, we can give it a special class we wipe during Postgres syncs, or we just trust the UI looks fast.
            const tempLocalId = `msg-local-final-${Date.now()}`;
            const div = document.createElement('div');
            div.id = tempLocalId;
            div.className = `chat-msg-row ${isUser ? 'sent' : 'received'} local-temp-bubble${isGroupMid ? ' group-mid' : ''}`;
            div.innerHTML = `
                <div class="msg-avatar-wrap">
                    <div class="msg-avatar-circle">${initials}</div>
                </div>
                <div class="msg-content">
                    <div class="msg-role-label">${roleLabel}</div>
                    <div class="msg-bubble">${transcriptText}</div>
                    <div class="msg-timestamp">${ts}</div>
                </div>
            `;
            liveTranscriptContainer.appendChild(div);
            scrollToBottom();
            return;
        }

        // --- Processing Interim ---
        let div = document.getElementById(interimId);
        if (!div) {
            // Group logic for interim bubble
            const prevNodes = Array.from(liveTranscriptContainer.querySelectorAll('.chat-msg-row'));
            const lastNode = prevNodes.length > 0 ? prevNodes[prevNodes.length - 1] : null;
            let isGroupMid = false;
            if (lastNode && lastNode.classList.contains(isUser ? 'sent' : 'received')) {
                isGroupMid = true;
            }

            div = document.createElement('div');
            div.id = interimId;
            div.className = `chat-msg-row ${isUser ? 'sent' : 'received'} interim-msg${isGroupMid ? ' group-mid' : ''}`;

            div.innerHTML = `
                <div class="msg-avatar-wrap">
                    <div class="msg-avatar-circle">${initials}</div>
                </div>
                <div class="msg-content">
                    <div class="msg-role-label">${roleLabel}</div>
                    <div class="msg-bubble" style="opacity: 0.6; font-style: italic;">${transcriptText}</div>
                    <div class="msg-timestamp">${ts}</div>
                </div>
            `;
            liveTranscriptContainer.appendChild(div);
        } else {
            const textEl = div.querySelector('.msg-bubble');
            if (textEl) textEl.textContent = transcriptText;
        }

        scrollToBottom();
    };

    // --- Subscribe to Live Calls List (Auto-Refresh) ---
    function subscribeToLiveCallsList() {
        window.appSupabase
            .channel('live-calls-list')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'vapi_calls' },
                (payload) => {
                    console.log('Live Calls List Update:', payload);
                    handleCallListUpdate(payload);
                }
            )
            .subscribe();
    }

    function handleCallListUpdate(payload) {
        const newCall = payload.new;
        if (!newCall) return;

        // Check if row already exists
        let row = Array.from(liveCallsTableBody.querySelectorAll('tr')).find(tr => {
            const btn = tr.querySelector('.view-live-btn');
            return btn && btn.dataset.id === newCall.call_id;
        });

        if (newCall.status === 'ended') {
            // NEW: Automatically close modal if the current active call has ended in the database
            if (currentCallId === newCall.call_id) {
                console.log('[Live] Current call ended in DB, closing modal.');
                window.closeLiveModal();
            }

            if (row) {
                row.remove();
                if (liveCallsTableBody.children.length === 0) {
                    liveCallsTableBody.innerHTML = `
                        <tr>
                            <td colspan="4">
                                <div class="live-empty-state">
                                    <div class="live-empty-icon">
                                        <i class="fa-solid fa-phone-slash" style="color: #6366f1; font-size: 1.3rem;"></i>
                                    </div>
                                    <div>
                                        <p style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin: 0 0 5px;">No Active Calls</p>
                                        <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0; max-width: 300px;">All agents are currently idle. Live calls will appear here automatically.</p>
                                    </div>
                                </div>
                            </td>
                        </tr>`;
                }
            }
            return;
        }

        const isLive = newCall.status === 'in-progress' || newCall.status === 'started';

        // Filter out stale records: If a call is 'in-progress' but hasn't been updated in 30 minutes, ignore it.
        const lastUpdate = new Date(newCall.updated_at || newCall.created_at);
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

        if (isLive) {
            console.log(`[Live] Received active call: ${newCall.call_id}, Last Update: ${lastUpdate}`);
            // Removed strict stale check to ensure visibility
        }

        const statusLabel = isLive ? 'Live' : (newCall.status.charAt(0).toUpperCase() + newCall.status.slice(1));

        const rowHTML = `
            <td>
                ${isLive
                ? `<span class="live-badge"><span class="live-dot"></span>Live</span>`
                : `<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;font-weight:600;color:#94a3b8;"><i class="fa-solid fa-circle" style="font-size:6px;"></i>${statusLabel}</span>`
            }
            </td>
            <td><span class="live-call-id">${newCall.call_id ? newCall.call_id.substring(0, 12) + '...' : 'Unknown'}</span></td>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">${new Date(newCall.created_at).toLocaleString()}</td>
            <td style="text-align: right;">
                <button class="btn-live-view view-live-btn" data-id="${newCall.call_id}" data-started-at="${newCall.started_at || newCall.created_at}">
                    <i class="fa-solid fa-eye"></i> Live View
                </button>
            </td>
        `;

        if (row) {
            // Update existing row
            row.innerHTML = rowHTML;
            // Re-attach listener
            const btn = row.querySelector('.view-live-btn');
            if (btn) btn.addEventListener('click', () => openLiveModal(btn.dataset.id, btn.dataset.startedAt));
        } else {
            // Prepend new row
            const newRow = document.createElement('tr');
            newRow.innerHTML = rowHTML;

            // Remove "No calls" message if present
            if (liveCallsTableBody.querySelector('td[colspan]')) {
                liveCallsTableBody.innerHTML = '';
            }

            liveCallsTableBody.insertBefore(newRow, liveCallsTableBody.firstChild);

            // Add row click listener for new row
            newRow.style.cursor = 'pointer';
            newRow.addEventListener('click', (e) => {
                if (e.target.closest('.view-live-btn')) return;
                openLiveModal(newCall.call_id, newCall.started_at || newCall.created_at);
            });

            // Attach listener
            const btn = newRow.querySelector('.view-live-btn');
            if (btn) btn.addEventListener('click', () => openLiveModal(btn.dataset.id, btn.dataset.startedAt));
        }

        // Keep sidebar badge in sync
        syncSidebarBadge();
    }

    // Initialize
    // Initialize with safe check for Supabase
    const initInterval = setInterval(() => {
        if (window.appSupabase) {
            clearInterval(initInterval);
            subscribeToLiveCallsList();
        }
    }, 200);

    // Timeout to stop checking after 5 seconds to prevent infinite loop
    setTimeout(() => clearInterval(initInterval), 5000);

    // Initial Fetch
    window.fetchLiveCalls();

    // Auto-refresh the live calls list every 2 seconds for real-time monitoring
    setInterval(() => {
        if (typeof window.fetchLiveCalls === 'function' && window.appSupabase) {
            window.fetchLiveCalls();
        }
    }, 2000);

    function scrollToBottom() {
        if (liveTranscriptContainer) {
            liveTranscriptContainer.scrollTop = liveTranscriptContainer.scrollHeight;
        }
    }
});
