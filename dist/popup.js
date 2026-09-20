document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('bm-toggle');
    const status = document.getElementById('bm-status');

    function formatPlan(plan) {
        var p = (plan || '').toString().toLowerCase();
        if (p.indexOf('pro') !== -1) return 'Pro';
        if (p.indexOf('basic') !== -1) return 'Basic';
        return 'Inactive';
    }

    function updateUI() {
        chrome.storage.local.get('bjmoon_enabled', (res) => {
            const enabled = res.bjmoon_enabled !== false;
            toggle.checked = enabled;
        });

        chrome.runtime.sendMessage({action:'checkLicense'}, function(res){
            var paid = res && res.paid;
            var planLabel = formatPlan(res ? res.plan : '');
            var days = 0;
            chrome.storage.local.get('bjmoon_sub_days', function(r){
                days = (r && r.bjmoon_sub_days !== undefined) ? r.bjmoon_sub_days : 0;
                var text = '';
                if (!paid) {
                    text = 'Inactive';
                } else {
                    text = planLabel + (days > 0 ? ' — ' + days + 'd' : '');
                }
                status.textContent = text;
                status.style.color = paid ? '#22c55e' : '#a0a0a0';
            });
        });
    }

    updateUI();
    setInterval(updateUI, 15000);

    toggle.addEventListener('change', () => {
        const enabled = toggle.checked;
        chrome.storage.local.set({ bjmoon_enabled: enabled }, () => {
            updateUI();
        });
    });
});
