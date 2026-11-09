/* Mark Sims — site behaviour. Everything is read from the page itself (the gallery,
   the footer's list of categories, the film cards), so it works the same on the
   static site and once the site is imported. The viewer is js/lightbox.js. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const LB = window.Lightbox;
  const BASE = document.baseURI;
  const abs = u => new URL(u, BASE).href;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pad = n => String(n).padStart(2, "0");
  const text = n => (n ? n.textContent.replace(/\s+/g, " ").trim() : "");

  /* ---------- clocks: St Albans time, to the second where it says so ---------- */
  const fmt = {};
  function tick() {
    const now = new Date();
    $$("[data-clock]").forEach(t => {
      const s = t.hasAttribute("data-seconds");
      const k = t.dataset.clock + s;
      fmt[k] = fmt[k] || new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: s ? "2-digit" : undefined, hour12: false, timeZone: t.dataset.clock });
      t.textContent = fmt[k].format(now);
    });
  }
  tick();
  setInterval(tick, 1000);

  /* ---------- header and menu ---------- */
  const hdr = $("[data-hdr]");
  let lastY = scrollY;
  function onScroll() {
    const y = scrollY;
    hdr.classList.toggle("is-scrolled", y > 10);
    if (Math.abs(y - lastY) > 6 && !root.classList.contains("menu-open")) { root.classList.toggle("hdr-away", y > lastY && y > 400); lastY = y; }
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  // compared as resolved paths, so it holds at the site root and under a subpath (a GitHub Pages preview)
  const here = location.pathname.replace(/index\.html$/, "");
  const homePath = new URL($(".logo").href).pathname;
  $$(".nav a").forEach(a => { const h = new URL(a.href).pathname; if (h !== homePath && here.startsWith(h)) a.setAttribute("aria-current", "page"); });
  const menuBtn = $("[data-menu]");
  const setMenu = open => {
    root.classList.toggle("menu-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    $(".menu-word", menuBtn).textContent = open ? "Close" : "Menu";
    if (open) { const first = $(".nav a"); if (first) first.focus(); }
  };
  menuBtn.addEventListener("click", () => setMenu(!root.classList.contains("menu-open")));
  addEventListener("keydown", e => { if (e.key === "Escape" && root.classList.contains("menu-open")) { setMenu(false); menuBtn.focus(); } });
  $$(".nav a").forEach(a => a.addEventListener("click", () => setMenu(false)));
  // the cookie settings link is codanomiq's; on the static site it has nothing to open
  $$("[data-cnx-consent]").forEach(a => a.addEventListener("click", e => { if (!window.cdnmxConsent) e.preventDefault(); }));

  /* ---------- the giant titles: never break a word, shrink until the longest fits ---------- */
  const titles = $$(".page-title, .rec-title, .panel-word, .split-title");
  function fitTitles() {
    titles.forEach(t => {
      t.style.fontSize = "";
      const words = t.textContent.trim().split(/\s+/);
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:inherit;letter-spacing:inherit;text-transform:inherit";
      t.appendChild(probe);
      const vertical = getComputedStyle(t).writingMode.startsWith("vertical");
      const room = vertical ? t.parentElement.clientHeight - 48 : t.clientWidth;
      const widest = Math.max(...words.map(w => { probe.textContent = w; return probe.getBoundingClientRect()[vertical ? "height" : "width"] || probe.offsetWidth; }));
      probe.remove();
      if (widest > room && room > 0) t.style.fontSize = (parseFloat(getComputedStyle(t).fontSize) * room / widest * 0.98) + "px";
    });
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(fitTitles);
  addEventListener("resize", fitTitles);

  /* ---------- home: the opening pictures change slowly ---------- */
  const slides = $$(".slide");
  if (slides.length > 1) {
    const name = $("[data-slide-name]"), num = $("[data-slide-n]");
    let k = 0;
    const show = i => {
      slides[k].classList.remove("is-on");
      k = i;
      slides[k].classList.add("is-on");
      if (name) name.textContent = text($("figcaption", slides[k]));
      if (num) num.textContent = `${pad(k + 1)} / ${pad(slides.length)}`;
    };
    show(0);
    if (!reduce()) setInterval(() => { if (!document.hidden && !root.classList.contains("lb-open")) show((k + 1) % slides.length); }, 5200);
  }

  if (!LB) return;

  /* ---------- a category's gallery, and the categories either side of it ---------- */
  const cats = $$("[data-cats] a").map(a => ({ url: abs(a.getAttribute("href")), title: text(a) }));
  const catIndex = url => cats.findIndex(c => c.url === url);
  function catOpts(set, i, extra) {
    const nb = d => cats[(i + d + cats.length) % cats.length];
    const go = d => {
      const j = (i + d + cats.length) % cats.length;
      LB.load(cats[j].url).then(s => LB.open(Object.assign(s, { url: cats[j].url }), catOpts(s, j, { dir: d }))).catch(() => { location.href = cats[j].url; });
    };
    const pics = set.media.filter(m => !m.film).length;
    return Object.assign({
      kicker: [set.title, `${pics} ${pics === 1 ? "photograph" : "photographs"}`],
      where: `${pad(i + 1)} / ${pad(cats.length)} · Photography`,
      next: cats.length > 1 ? { title: nb(1).title, img: "", go } : null,
      prev: cats.length > 1 ? { title: nb(-1).title, img: "", go } : null,
      nextLabel: "Next category",
      pageLabel: "Open the gallery page",
      pageLink: i !== catIndex(location.href.split("#")[0])
    }, extra);
  }
  const gallery = $(".rec-gallery");
  if (gallery) {
    const set = LB.read(document, location.href);
    const i = Math.max(0, catIndex(location.href.split("#")[0]));
    const openAt = (at, from) => LB.open(set, catOpts(set, i, { at, from, pageLink: false }));
    gallery.addEventListener("click", e => {
      const a = e.target.closest(".rec-pic a");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      openAt($$(".rec-pic", gallery).indexOf(a.closest(".rec-pic")), a);
    });
    const lead = $(".rec-lead");
    if (lead) lead.addEventListener("click", () => openAt(0, lead));
    // the next category is ready before it is asked for
    if (cats.length) LB.load(cats[(i + 1) % cats.length].url).catch(() => {});
  }

  /* ---------- films: each one its own set, one after another ---------- */
  const filmLinks = [];
  $$("[data-film]").forEach(a => { if (!filmLinks.some(x => x.href === a.href)) filmLinks.push(a); });
  const filmSet = a => {
    const card = a.closest("li") || a;
    const title = a.dataset.title || text($(".film-title", card));
    const client = a.dataset.client || text($(".client", card));
    const dur = a.dataset.duration || text($(".duration", card));
    const im = $("img", a);
    return {
      url: "", title, line: [client, dur].filter(Boolean).join(" · "), quote: "", story: "", links: [{ label: "Vimeo", href: a.href }],
      facts: [client && ["Client", client], dur && ["Running time", dur]].filter(Boolean),
      media: [{ film: true, embed: LB.filmEmbed(a.href), href: a.href, title, poster: im ? (im.currentSrc || im.src) : "" }],
      mode: "single"
    };
  };
  function openFilm(i, from, dir) {
    const a = filmLinks[i];
    const n = d => filmLinks[(i + d + filmLinks.length) % filmLinks.length];
    const go = d => openFilm((i + d + filmLinks.length) % filmLinks.length, null, d);
    const imgOf = x => { const im = $("img", x); return im ? (im.currentSrc || im.src) : ""; };
    LB.open(filmSet(a), {
      from, dir,
      kicker: ["Film", `${pad(i + 1)} / ${pad(filmLinks.length)}`],
      where: "Videography",
      next: filmLinks.length > 1 ? { title: filmSet(n(1)).title, img: imgOf(n(1)), go } : null,
      prev: filmLinks.length > 1 ? { title: filmSet(n(-1)).title, img: imgOf(n(-1)), go } : null,
      nextLabel: "Next film",
      pageLink: false
    });
  }
  filmLinks.forEach((a, i) => {
    if (!LB.filmEmbed(a.href)) return;
    a.addEventListener("click", e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); openFilm(i, a); });
  });
  // every link to a film opens the same viewer, wherever it is on the page
  $$("a[data-film]").forEach(a => { if (!filmLinks.includes(a)) a.addEventListener("click", e => { e.preventDefault(); openFilm(filmLinks.findIndex(x => x.href === a.href), a); }); });
})();
