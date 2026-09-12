/* Progressively enhance the captured walkthrough. No commands or network calls. */
(function () {
  'use strict';

  var demo = document.querySelector('[data-demo]');
  if (!demo) return;
  var steps = Array.from(demo.querySelectorAll('[data-demo-step]'));
  var dots = Array.from(demo.querySelectorAll('[data-demo-go]'));
  var controls = demo.querySelector('[data-demo-controls]');
  var previous = demo.querySelector('[data-demo-prev]');
  var next = demo.querySelector('[data-demo-next]');
  var status = demo.querySelector('[data-demo-status]');
  var current = 0;

  function show(index, updateHash) {
    if (index < 0 || index >= steps.length) return;
    current = index;
    steps.forEach(function (step, position) { step.hidden = position !== current; });
    dots.forEach(function (dot, position) {
      if (position === current) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    previous.setAttribute('aria-disabled', String(current === 0));
    next.setAttribute('aria-disabled', String(current === steps.length - 1));
    status.textContent = 'Step ' + (current + 1) + ' of ' + steps.length;
    if (updateHash && window.location.hash !== '#' + steps[current].id) {
      // Keep the controls in view while giving Back/Forward a step to revisit.
      window.history.pushState(null, '', '#' + steps[current].id);
    }
  }

  function readHash() {
    var index = steps.findIndex(function (step) { return '#' + step.id === window.location.hash; });
    if (index !== -1) show(index, false);
    else if (!window.location.hash || window.location.hash === '#how-it-works') show(0, false);
  }

  dots.forEach(function (dot, index) {
    dot.addEventListener('click', function () { show(index, true); });
  });
  previous.addEventListener('click', function () { show(current - 1, true); });
  next.addEventListener('click', function () { show(current + 1, true); });
  window.addEventListener('hashchange', readHash);
  window.addEventListener('popstate', readHash);
  show(0, false);
  readHash();
  controls.hidden = false;
})();
