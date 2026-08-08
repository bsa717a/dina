/* Runs before React. Stops the browser from navigating to dropped files. */
(function () {
  if (typeof window === "undefined") return;

  window.__dinaPendingDropFiles = window.__dinaPendingDropFiles || [];
  window.__dinaFileDropHandler = window.__dinaFileDropHandler || null;

  function asArray(list) {
    try {
      return Array.prototype.slice.call(list || []);
    } catch (_) {
      return [];
    }
  }

  function hasFiles(e) {
    try {
      var types = e.dataTransfer && e.dataTransfer.types;
      if (!types) return !!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length);
      for (var i = 0; i < types.length; i += 1) {
        if (types[i] === "Files") return true;
      }
    } catch (_) {}
    return false;
  }

  function onDragOver(e) {
    e.preventDefault();
    try {
      if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) ? "copy" : "none";
    } catch (_) {}
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    var files = e.dataTransfer && e.dataTransfer.files ? asArray(e.dataTransfer.files) : [];
    if (!files.length) return;

    if (typeof window.__dinaFileDropHandler === "function") {
      try {
        window.__dinaFileDropHandler(files);
      } catch (_) {}
      return;
    }

    window.__dinaPendingDropFiles.push.apply(window.__dinaPendingDropFiles, files);
    try {
      window.dispatchEvent(
        new CustomEvent("dina:files-dropped", { detail: { files: files } }),
      );
    } catch (_) {}
  }

  var opts = { capture: true, passive: false };
  window.addEventListener("dragenter", onDragOver, opts);
  window.addEventListener("dragover", onDragOver, opts);
  window.addEventListener("drop", onDrop, opts);
  document.addEventListener("dragenter", onDragOver, opts);
  document.addEventListener("dragover", onDragOver, opts);
  document.addEventListener("drop", onDrop, opts);
})();
