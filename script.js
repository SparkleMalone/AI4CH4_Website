document.addEventListener('DOMContentLoaded', function () {
  // Header background on scroll
  const header = document.querySelector('.site-header');
  if (header) {
    function updateHeader() {
      if (window.scrollY > 60) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }
    window.addEventListener('scroll', updateHeader, { passive: true });
    updateHeader();
  }

  // Scroll-triggered reveal animations
  const revealEls = document.querySelectorAll('.reveal');
  if (!revealEls.length) return;

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          if (entry.target.classList.contains('network-section') && window._participantMap) {
            setTimeout(function () { window._participantMap.invalidateSize(); }, 50);
          }
          observer.unobserve(entry.target);
        }
      });
    },
    {
      root: null,
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.1
    }
  );

  revealEls.forEach(function (el) {
    observer.observe(el);
  });
});
