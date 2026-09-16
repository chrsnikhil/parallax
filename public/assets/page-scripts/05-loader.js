(function () {
  'use strict';
  document.body.style.visibility = 'visible';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow  = 'hidden';
  document.body.style.position  = 'fixed';
  document.body.style.width     = '100%';
  var loader    = document.getElementById('site-loader');
  var bar       = document.getElementById('loader-bar');
  var exited    = false;
  var glbReady  = false;
  var minReady  = false;
  var progress  = 0;
  var rafId     = null;
  var uiRevealed = false;
  function revealUI() {
    if (uiRevealed) return;
    uiRevealed = true;
    window.dispatchEvent(new CustomEvent('loaderExited'));
  }
  function animateBar(target, speed) {
    cancelAnimationFrame(rafId);
    (function tick() {
      progress += (target - progress) * speed;
      if (Math.abs(target - progress) < 0.3) progress = target;
      bar.style.width = progress.toFixed(1) + '%';
      if (progress < target) rafId = requestAnimationFrame(tick);
    })();
  }
  animateBar(70, 0.04);
  function tryExit() {
    if (glbReady && minReady) {
      animateBar(100, 0.12);
      setTimeout(exitLoader, 400);
    }
  }
  function exitLoader() {
    if (exited) return;
    exited = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.style.overflow = '';
        document.body.style.overflow  = '';
        document.body.style.position  = '';
        document.body.style.width     = '';
        window.scrollTo(0, 0);
        loader.classList.add('is-exiting');
        loader.addEventListener('transitionend', function onDone(e) {
          if (e.propertyName !== 'transform') return;
          loader.removeEventListener('transitionend', onDone);
          if (loader.parentNode) loader.parentNode.removeChild(loader);
          revealUI();
        });
        setTimeout(function () {
          if (loader.parentNode) loader.parentNode.removeChild(loader);
          revealUI();
        }, 1200);
      });
    });
  }
  setTimeout(function () {
    minReady = true;
    tryExit();
  }, 3000);
  var safetyTimer = setTimeout(function () {
    glbReady = minReady = true;
    exitLoader();
  }, 12000);
  window.addEventListener('glbLoaded', function () {
    clearTimeout(safetyTimer);
    setTimeout(function () {
      glbReady = true;
      tryExit();
    }, 400);
  });
})();