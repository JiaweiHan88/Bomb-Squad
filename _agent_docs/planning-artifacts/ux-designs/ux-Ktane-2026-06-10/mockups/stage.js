/* Bomb Squad — fits the fixed 1920×1080 .stage into any viewport (letterbox on black).
   Per EXPERIENCE.md "Responsive & Platform": 1280×720 min, 1920×1080 baseline, up to 4K;
   bomb scene letterboxes vertically, never crops. */
(function () {
  function fit() {
    var stage = document.querySelector('.stage');
    if (!stage) return;
    var sw = window.innerWidth, sh = window.innerHeight;
    var scale = Math.min(sw / 1920, sh / 1080);
    stage.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
  document.addEventListener('DOMContentLoaded', fit);
  fit();
})();
