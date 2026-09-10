/* SkillRights shared UI: one-click copy for [data-copy] buttons. No network calls. */
(function () {
  "use strict";

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function copyText(text, btn) {
    var old = btn.textContent;
    var done = function () {
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(function () {
        btn.textContent = old;
        btn.classList.remove("copied");
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  document.addEventListener("click", function (e) {
    var target = e.target;
    while (target && target !== document && !(target.hasAttribute && target.hasAttribute("data-copy"))) {
      target = target.parentNode;
    }
    if (target && target.hasAttribute && target.hasAttribute("data-copy")) {
      var id = target.getAttribute("data-copy");
      var el = document.getElementById(id);
      if (el) copyText(el.textContent, target);
    }
  });
})();
