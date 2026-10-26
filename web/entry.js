// Route by device rather than viewport width: a narrow PC window stays a mixer.
(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches || navigator.standalone === true;
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const welcome = new URL(location.href).searchParams.has('welcome');
  if (!welcome && (standalone || !mobile)) location.replace(new URL('./mixer.html', location.href));
  document.documentElement.dataset.device = mobile ? 'mobile' : 'desktop';
})();
