const PAGES = [
  { href: "index.html", id: "home", label: "Home" },
  { href: "stats.html", id: "stats", label: "Your stats" },
  { href: "friends.html", id: "friends", label: "Friends" },
  { href: "activity.html", id: "activity", label: "Activity" },
  { href: "settings.html", id: "settings", label: "Settings" },
];

const STAR =
  '<svg class="ornament-star" viewBox="0 0 24 24"><path d="M12 2.5l2.6 6.4 6.9.6-5.2 4.6 1.6 6.7L12 16.8l-6 3.9 1.6-6.7-5.2-4.6 6.9-.6L12 2.5z" /></svg>';
const STAR_SM =
  '<svg class="ornament-star ornament-star-sm" viewBox="0 0 24 24"><path d="M12 2.5l2.6 6.4 6.9.6-5.2 4.6 1.6 6.7L12 16.8l-6 3.9 1.6-6.7-5.2-4.6 6.9-.6L12 2.5z" /></svg>';
const MOON =
  '<svg class="ornament-moon" viewBox="0 0 24 24"><path d="M16.5 3.2a9.2 9.2 0 1 0 4.3 16.1 8 8 0 1 1-4.3-16.1z" /></svg>';

export function mountSiteNav(currentPage) {
  document.querySelectorAll("[data-site-nav]").forEach((nav) => {
    nav.setAttribute("aria-label", "Site pages");
    nav.innerHTML = PAGES.map((page) => {
      const current = page.id === currentPage;
      const currentClass = current ? " is-current" : "";
      const currentAttr = current ? ' aria-current="page"' : "";
      return `<a class="page-nav-link${currentClass}" href="${page.href}"${currentAttr}>${page.label}</a>`;
    }).join("");
  });
}

export function mountSectionDivider(label) {
  const el = document.querySelector("[data-section-divider]");
  if (!el) return;
  el.classList.add("section-divider");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <span class="section-divider-ornament" data-side="left">
      ${STAR}${MOON}${STAR_SM}
    </span>
    <span class="section-divider-label">${label}</span>
    <span class="section-divider-ornament" data-side="right">
      ${STAR_SM}${MOON}${STAR}
    </span>
  `;
}
