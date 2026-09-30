function show(t){var d=document.createElement('pre');d.style.cssText='background:#fee;color:#900;padding:8px;font-size:11px;white-space:pre-wrap;position:relative;z-index:99999';d.textContent=t;document.body.prepend(d);}
window.addEventListener('error',function(e){show('ERROR: '+e.message+' @ '+e.filename+':'+e.lineno);});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;show('PROMISE: '+((r&&r.stack)||r));});
