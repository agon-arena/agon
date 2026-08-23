(function lockMnoriaZoom() {
  function preventZoom(event) {
    event.preventDefault();
  }

  document.addEventListener("gesturestart", preventZoom, { passive: false });
  document.addEventListener("gesturechange", preventZoom, { passive: false });
  document.addEventListener("gestureend", preventZoom, { passive: false });
  document.addEventListener("wheel", function(event) {
    if (event.ctrlKey) preventZoom(event);
  }, { passive: false });
})();
