/* Runs before React so Chrome's install event is not missed. */
(function () {
  if (typeof window === "undefined") return;

  window.__dinaDeferredInstall = window.__dinaDeferredInstall || null;

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    window.__dinaDeferredInstall = event;
  });

  window.addEventListener("appinstalled", function () {
    window.__dinaDeferredInstall = null;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
  }
})();
