// Shared preview navigation bar.
(function () {
  var PAGES = [
    ["products.html", "Products"],
    ["product.html", "Editing dashboard"],
    ["setup.html", "Setup"],
    ["settings.html", "Settings"],
    ["storefront.html", "Storefront"],
  ];

  var here = location.pathname.split("/").pop() || "dashboard.html";
  var bar = document.createElement("nav");
  bar.className = "pv-bar";

  var title = document.createElement("span");
  title.className = "pv-bar__title";
  title.textContent = "AI Disclosure — UI preview";
  bar.appendChild(title);

  PAGES.forEach(function (page) {
    var link = document.createElement("a");
    link.href = page[0];
    link.textContent = page[1];
    if (page[0] === here) link.setAttribute("aria-current", "page");
    bar.appendChild(link);
  });

  var note = document.createElement("span");
  note.className = "pv-bar__note";
  note.textContent = "Static preview — sample data";
  bar.appendChild(note);

  document.body.insertBefore(bar, document.body.firstChild);
})();
