// v8.0: Setzt vor dem React-Start den Hell/Dunkel-Modus aus dem gespeicherten
// Theme, damit das Fenster nicht erst weiss und dann dunkel aufblitzt.
(function () {
  try {
    var t = localStorage.getItem('coremail-theme') || 'light';
    var light = { light: 1, minimal: 1, lollipop: 1 };
    var mode = light[t] ? 'light' : 'dark';
    document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = mode;
  } catch (e) {}
})();
