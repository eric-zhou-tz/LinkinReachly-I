// Injected at document_start to force all shadow roots to 'open' mode.
// This must run before LinkedIn's bundle creates closed shadow roots for the
// SDUI Easy Apply modal inside #interop-outlet.
;(function() {
  const script = document.createElement('script')
  script.textContent = `(function(){
    if (window.__linkinreachly_shadow_forcer__) return;
    window.__linkinreachly_shadow_forcer__ = true;
    const _attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      if (init && init.mode === 'closed') init = Object.assign({}, init, { mode: 'open' });
      return _attachShadow.call(this, init);
    };
  })();`
  ;(document.head || document.documentElement).prepend(script)
  script.remove()
})()
