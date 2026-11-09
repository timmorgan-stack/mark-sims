/* The light box: a branded viewer for a set of pictures and films.
   Shared by the George Chambers and Mark Sims sites (one file, copied into each).

   A set is read from a RECORD PAGE - the page a Listings record publishes to -
   so the light box works the same on the static site and once it is imported:

     main .rec-title               the name (h1)
     main .rec-line, .rec-quote    the one-line summary, a pull quote
     main dl.rec-facts dt + dd     label and value pairs; a Vimeo/YouTube link is a film
     main .rec-story               the story, shown as it is
     main .rec-gallery img         the pictures, in order; data-lb-mode="sheet" opens on the contact sheet

   window.Lightbox.read(doc, url)  -> a set, from a fetched record page or this one
   A set can also be built by hand: {title, line, quote, facts: [[label, value]], links: [{label, href}],
   story (HTML), media: [{src, srcset, alt, w, h} | {film: true, embed, href, title, poster}], mode, url}.
   window.Lightbox.open(set, opts) -> shows it; opts: from (element to grow out of), at,
                                      where (the bar's words), kicker, next/prev ({title, img, go()}),
                                      history (true: the address bar follows the open set)
   window.Lightbox.close()

   Films load from Vimeo or YouTube only when played, and only once the visitor has
   allowed embedded content (window.cdnmxConsent, codanomiq's cookie banner). */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const EASE = "cubic-bezier(.7, 0, .2, 1)";
  const OUT = "cubic-bezier(.16, 1, .3, 1)";
  const pad = n => String(n).padStart(2, "0");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const text = n => (n ? n.textContent.replace(/\s+/g, " ").trim() : "");

  // A Web Animation that always settles: a stalled timeline (a background tab)
  // must never leave the light box half open.
  function anim(el, frames, opts, then) {
    const a = el.animate(frames, opts);
    let done = false;
    const fin = () => { if (done) return; done = true; if (then) then(a); };
    a.onfinish = fin;
    setTimeout(fin, (opts.duration || 0) + (opts.delay || 0) + 150);
    return a;
  }
  const cancel = a => a.cancel();

  /* ---------- reading a set off a record page ---------- */

  function filmEmbed(href) {
    let m = href.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]{6,}))?/i);
    if (m) return "https://player.vimeo.com/video/" + m[1] + (m[2] ? "?h=" + m[2] : "");
    m = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/)([\w-]{6,})/i);
    if (m) return "https://www.youtube-nocookie.com/embed/" + m[1];
    return "";
  }
  const filmHost = embed => (/youtube/.test(embed) ? "YouTube" : "Vimeo");

  function read(doc, url) {
    const main = doc.querySelector("main") || doc.body;
    const abs = u => { try { return new URL(u, url).href; } catch (e) { return u; } };
    const facts = [], films = [], links = [];
    $$("dl.rec-facts dt", main).forEach(dt => {
      const dd = dt.nextElementSibling;
      if (!dd || dd.tagName !== "DD") return;
      const label = text(dt);
      const a = dd.querySelector("a[href]");
      if (a) {
        const href = a.getAttribute("href");
        const embed = filmEmbed(href);
        if (embed) films.push({ film: true, embed, href: abs(href), title: /^link/i.test(label) ? "Film " + (films.length + 1) : label });
        else links.push({ label, href: abs(href) });
        return;
      }
      if (text(dd)) facts.push([label, text(dd)]);
    });
    const gallery = $(".rec-gallery", main);
    const pictures = gallery ? $$("img", gallery).map(img => ({
      src: abs(img.getAttribute("src")),
      srcset: img.getAttribute("srcset") ? img.getAttribute("srcset").split(",").map(p => { const [u, w] = p.trim().split(/\s+/); return abs(u) + (w ? " " + w : ""); }).join(", ") : "",
      alt: img.getAttribute("alt") || "",
      w: +img.getAttribute("width") || 0,
      h: +img.getAttribute("height") || 0
    })) : [];
    const story = $(".rec-story", main);
    // a pair labelled by a (visually hidden) h6: the import keeps the label, not always the value's class
    const pair = (...labels) => { const h = $$("h6", main).find(x => labels.includes(text(x))); return h ? h.nextElementSibling : null; };
    return {
      url,
      title: text($(".rec-title", main) || $("h1", main)),
      line: text($(".rec-line", main) || pair("Project", "Where", "Summary")),
      quote: text($(".rec-quote", main) || pair("Quote")),
      facts, links,
      story: story ? Array.from(story.children).filter(n => text(n)).map(n => n.outerHTML).join("") : "",
      media: films.concat(pictures),
      mode: gallery && gallery.getAttribute("data-lb-mode") === "sheet" ? "sheet" : "single"
    };
  }

  // Fetch a record page and read it; the same page twice is fetched once.
  const pages = new Map();
  function load(url) {
    if (!pages.has(url)) {
      pages.set(url, fetch(url, { credentials: "same-origin" })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(html => read(new DOMParser().parseFromString(html, "text/html"), url))
        .catch(e => { pages.delete(url); throw e; }));
    }
    return pages.get(url);
  }

  /* ---------- the box itself, built once ---------- */

  let lb, info, stage, track, sheet, strip, countEl, where, lens, prevBtn, nextBtn, cursor, cursorText;
  function build() {
    if (lb) return;
    lb = document.createElement("dialog");
    lb.className = "lb";
    lb.setAttribute("aria-labelledby", "lb-title");
    lb.innerHTML = `
      <div class="lb-bar">
        <button class="lb-close" type="button" data-lb-close><span class="lb-x" aria-hidden="true"></span>Close</button>
        <p class="lb-where" data-lb-where></p>
        <div class="lb-tools">
          <div class="lb-mode" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked="true" data-mode="single">Single</button>
            <button type="button" role="radio" aria-checked="false" data-mode="sheet">Contact sheet</button>
          </div>
          <button class="lb-loupe" type="button" aria-pressed="false" data-loupe title="Loupe (L)"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M8.5 6v5M6 8.5h5"/></svg><span>Loupe</span></button>
          <div class="lb-pn">
            <button type="button" data-set="-1" aria-label="Previous"><span aria-hidden="true">←</span></button>
            <button type="button" data-set="1" aria-label="Next"><span aria-hidden="true">→</span></button>
          </div>
        </div>
      </div>
      <div class="lb-body">
        <aside class="lb-info" data-lb-info></aside>
        <div class="lb-stage" data-lb-stage>
          <div class="lb-track" data-lb-track tabindex="-1"></div>
          <div class="lb-sheet" data-lb-sheet tabindex="-1" hidden></div>
          <button class="lb-arrow lb-prev" type="button" data-step="-1" aria-label="Previous picture"><span aria-hidden="true">←</span></button>
          <button class="lb-arrow lb-next" type="button" data-step="1" aria-label="Next picture"><span aria-hidden="true">→</span></button>
          <div class="lb-foot">
            <p class="lb-count" aria-live="polite" data-lb-count></p>
            <div class="lb-strip" data-lb-strip></div>
            <p class="lb-keys" aria-hidden="true">← → browse · L loupe · S sheet · Esc close</p>
          </div>
        </div>
      </div>
      <div class="lb-lens" aria-hidden="true"></div>
      <div class="lb-cursor" aria-hidden="true"><span></span></div>`;
    document.body.appendChild(lb);
    info = $("[data-lb-info]", lb); stage = $("[data-lb-stage]", lb); track = $("[data-lb-track]", lb);
    sheet = $("[data-lb-sheet]", lb); strip = $("[data-lb-strip]", lb); countEl = $("[data-lb-count]", lb);
    where = $("[data-lb-where]", lb); lens = $(".lb-lens", lb); prevBtn = $(".lb-prev", lb); nextBtn = $(".lb-next", lb);
    cursor = $(".lb-cursor", lb); cursorText = cursor.firstElementChild;
    wire();
  }

  let S = null;          // the open set
  let O = {};            // its options
  let at = 0;            // the current slide; S.media.length is the end card
  let mode = "single";
  let loupe = false;
  let opener = null;
  let closing = false;
  let pushed = false;
  let lastPointer = "mouse";
  const lastSlide = () => S.media.length - (O.next ? 0 : 1);

  /* ---------- drawing a set ---------- */

  function infoHTML() {
    const parts = [];
    if (O.kicker && O.kicker.length) parts.push(`<p class="lbi-kicker">${O.kicker.map((k, i) => i ? `<span>${esc(k)}</span>` : `<b>${esc(k)}</b>`).join("")}</p>`);
    parts.push(`<h2 class="lbi-title" id="lb-title">${esc(S.title)}</h2>`);
    if (S.line) parts.push(`<p class="lbi-line">${esc(S.line)}</p>`);
    if (S.quote) parts.push(`<blockquote class="lbi-quote">${esc(S.quote)}</blockquote>`);
    if (S.story) parts.push(`<div class="lbi-body">${S.story}</div>`);
    if (S.facts.length) parts.push(`<dl class="lbi-dl">${S.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`);
    if (S.links.length) parts.push(`<p class="lbi-links">${S.links.map(l => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(hostOf(l.href))} ↗</a>`).join("")}</p>`);
    if (S.url && O.pageLink !== false) parts.push(`<p class="lbi-links"><a href="${esc(S.url)}" data-lb-page>${esc(O.pageLabel || "Open as a page")} →</a></p>`);
    if (O.next) parts.push(`<button class="lbi-next${O.next.img ? "" : " no-img"}" type="button" data-set="1">${O.next.img ? `<img src="${esc(O.next.img)}" alt="" loading="lazy">` : ""}<span><small>${esc(O.nextLabel || "Next")}</small>${esc(O.next.title)}</span></button>`);
    return parts.map((h, i) => h.replace(/^<(\w+)/, `<$1 style="--i:${i}"`)).join("");
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }

  const marks = `<i class="cm cm-tl"></i><i class="cm cm-tr"></i><i class="cm cm-bl"></i><i class="cm cm-br"></i>`;
  function slideHTML(m, i) {
    if (m.film) {
      return `<div class="lb-slide is-film" data-i="${i}"><div class="lb-frame lb-film-plate${m.poster ? " has-poster" : ""}">
          ${m.poster ? `<img class="lb-film-poster" src="${esc(m.poster)}" alt="" decoding="async">` : ""}
          <span class="lb-film-host">${esc(filmHost(m.embed))}</span>
          <span class="lb-film-title">${esc(m.title)}</span>
          <button class="lb-play" type="button" data-play="${i}"><span>Play film</span></button>
          <span class="lb-film-note" data-film-note></span>${marks}</div></div>`;
    }
    const alt = esc(m.alt || `${S.title} — ${i + 1} of ${S.media.length}`);
    return `<div class="lb-slide" data-i="${i}"><div class="lb-frame"><img alt="${alt}" data-src="${esc(m.src)}"${m.srcset ? ` data-srcset="${esc(m.srcset)}" sizes="72vw"` : ""} data-w="${m.w}" data-h="${m.h}" decoding="async">${marks}</div></div>`;
  }
  function endHTML() {
    const n = O.next;
    return `<div class="lb-slide lb-slide-end" data-i="${S.media.length}"><div class="lb-end">
        <small>End of ${esc(S.title)} · Up next</small>
        <button class="lb-end-btn" type="button" data-set="1">${n.img ? `<img class="lb-end-img" src="${esc(n.img)}" alt="" loading="lazy">` : ""}<span class="lb-end-title"><span>${esc(n.title)}</span><span aria-hidden="true">→</span></span></button>
      </div></div>`;
  }
  const thumb = (m, i, cls) => m.film
    ? (m.poster ? `<span class="lb-thumb-film has-poster"><img src="${esc(m.poster)}" alt="" loading="lazy">▶</span>` : `<span class="lb-thumb-film">▶</span>`)
    : `<img src="${esc(m.src)}"${m.srcset ? ` srcset="${esc(m.srcset)}" sizes="${cls === "sheet" ? "160px" : "48px"}"` : ""} alt="" loading="lazy" decoding="async">`;

  function draw(startAt) {
    info.innerHTML = infoHTML();
    info.scrollTop = 0;
    track.innerHTML = S.media.map(slideHTML).join("") + (O.next ? endHTML() : "");
    strip.innerHTML = S.media.map((m, i) => `<button type="button" data-goto="${i}"${m.film ? ' class="is-film"' : ""} aria-label="${m.film ? "Film" : "Picture"} ${i + 1}">${thumb(m, i, "strip")}</button>`).join("");
    sheet.innerHTML = ""; sheet.dataset.built = "";
    where.innerHTML = esc(O.where || "");
    const pn = $(".lb-pn", lb);
    pn.hidden = !O.next && !O.prev;
    $$("[data-set]", pn).forEach(b => {
      const t = +b.dataset.set > 0 ? O.next : O.prev;
      b.disabled = !t; b.title = t ? (+b.dataset.set > 0 ? "Next: " : "Previous: ") + t.title : "";
    });
    $(".lb-mode", lb).hidden = S.media.filter(m => !m.film).length < 2;
    at = clamp(startAt || 0, 0, Math.max(0, S.media.length - 1));
    setMode(O.mode || S.mode, true);
    $$(".lb-frame img", track).forEach(fit);
  }

  // Each picture is sized to the stage by hand, so the crop marks sit on its corners.
  function box(slide) {
    const cs = getComputedStyle(slide);
    return [slide.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
            slide.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)];
  }
  function fit(img) {
    const [bw, bh] = box(img.closest(".lb-slide"));
    const ow = +img.dataset.w || img.naturalWidth, oh = +img.dataset.h || img.naturalHeight;
    if (!ow || !oh || bw <= 0 || bh <= 0) return;
    const s = Math.min(bw / ow, bh / oh, ow < 700 ? 1.6 : 1.3);
    img.style.width = Math.round(ow * s) + "px";
    img.style.height = Math.round(oh * s) + "px";
  }
  function loadSlide(i) {
    const slide = track.children[i];
    const img = slide && $("img[data-src]", slide);
    if (!img) return;
    img.onload = () => {
      img.classList.add("is-loaded");
      if (!+img.dataset.w) { img.dataset.w = img.naturalWidth; img.dataset.h = img.naturalHeight; fit(img); }
    };
    if (img.dataset.srcset) img.srcset = img.dataset.srcset;
    img.src = img.dataset.src;
    img.removeAttribute("data-src");
  }

  function setAt(i, scroll, instant) {
    at = clamp(i, 0, lastSlide());
    for (let k = at - 1; k <= at + 2; k++) loadSlide(k);
    const end = O.next && at === S.media.length;
    countEl.innerHTML = end ? `<b>Up next</b>` : `<b>${pad(at + 1)}</b> / ${pad(S.media.length)}`;
    prevBtn.disabled = at === 0;
    nextBtn.disabled = at >= lastSlide();
    $$("button", strip).forEach((b, k) => b.setAttribute("aria-current", String(k === at)));
    const cur = strip.children[at];
    if (cur) strip.scrollTo({ left: cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2, behavior: instant || reduce() ? "auto" : "smooth" });
    $$("iframe", track).forEach(f => { if (+f.closest(".lb-slide").dataset.i !== at) stopFilm(f); });
    if (scroll) track.scrollTo({ left: at * track.clientWidth, behavior: instant || reduce() ? "auto" : "smooth" });
  }
  function step(d) {
    if (d > 0 && at >= lastSlide()) { if (O.next) go(1); return; }
    setAt(at + d, true);
  }

  function setMode(m, quiet) {
    if (m === "sheet" && S.media.filter(x => !x.film).length < 2) m = "single";
    mode = m;
    lb.classList.toggle("is-sheet", m === "sheet");
    sheet.hidden = m !== "sheet";
    $$("[data-mode]", lb).forEach(b => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    if (m === "sheet") {
      if (!sheet.dataset.built) {
        sheet.innerHTML = S.media.map((x, i) => `<button type="button" data-goto="${i}" aria-label="Open ${x.film ? "film" : "picture"} ${i + 1}"><span class="sh-img">${thumb(x, i, "sheet")}</span><span class="sh-n"><span>${pad(i + 1)}</span><i>View</i></span></button>`).join("");
        sheet.dataset.built = "1";
      }
      $$("button", sheet).forEach((b, k) => b.setAttribute("aria-current", String(k === at)));
      sheet.scrollTop = 0;
      if (loupe) toggleLoupe();
      countEl.innerHTML = `<b>${S.media.length}</b> ${S.media.length === 1 ? "frame" : "frames"}`;
      if (!quiet) sheet.focus({ preventScroll: true });
    } else {
      requestAnimationFrame(() => {
        $$(".lb-frame img", track).forEach(fit);
        setAt(at, true, true);
        if (!quiet) track.focus({ preventScroll: true });
      });
    }
  }

  function toggleLoupe() {
    loupe = !loupe && mode === "single";
    lb.classList.toggle("is-loupe", loupe);
    $("[data-loupe]", lb).setAttribute("aria-pressed", String(loupe));
    if (!loupe) lens.classList.remove("is-on");
  }

  /* ---------- films, behind the visitor's consent ---------- */

  let waiting = null;   // a film the visitor asked for before allowing embeds
  function consentOK() {
    const c = window.cdnmxConsent;
    return !c || typeof c.allows !== "function" || c.allows("embeds");
  }
  function play(i) {
    const m = S.media[i];
    const slide = track.children[i];
    if (!m || !slide) return;
    const plate = $(".lb-frame", slide);
    if (!consentOK()) {
      $("[data-film-note]", plate).innerHTML = `This film is on ${esc(filmHost(m.embed))}, which sets its own cookies.
        <button type="button" class="lb-allow" data-allow="${i}">Choose cookie settings</button>`;
      return;
    }
    const [bw, bh] = box(slide);
    const ratio = 16 / 9;
    const w = Math.min(bw, bh * ratio, 1280);
    const f = document.createElement("iframe");
    f.className = "lb-video";
    f.allow = "autoplay; fullscreen; picture-in-picture";
    f.allowFullscreen = true;
    f.title = m.title || "Film";
    f.src = m.embed + (m.embed.includes("?") ? "&" : "?") + "autoplay=1" + (/vimeo/.test(m.embed) ? "&dnt=1" : "");
    plate.dataset.poster = plate.innerHTML;
    plate.classList.add("is-playing");
    plate.style.width = Math.round(w) + "px";
    plate.style.height = Math.round(w / ratio) + "px";
    plate.innerHTML = "";
    plate.appendChild(f);
  }
  function stopFilm(f) {
    const plate = f.closest(".lb-frame");
    plate.innerHTML = plate.dataset.poster || "";
    plate.classList.remove("is-playing");
    plate.style.width = plate.style.height = "";
  }
  function askConsent(i) {
    const c = window.cdnmxConsent;
    if (!c) return;
    waiting = i;
    c.open();
  }
  function listenConsent() {
    const c = window.cdnmxConsent;
    if (!c || typeof c.onChange !== "function" || listenConsent.done) return;
    listenConsent.done = true;
    c.onChange(state => {
      if (state && state.embeds && waiting !== null && lb && lb.open) { const i = waiting; waiting = null; play(i); }
    });
  }

  /* ---------- opening, moving between sets, closing ---------- */

  function rectOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.bottom < 0 || r.top > innerHeight) return null;
    return r;
  }
  const inset = r => `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px round 4px)`;
  const canPush = () => location.protocol !== "file:";

  function open(set, opts) {
    build();
    listenConsent();
    if (closing) return;
    opts = opts || {};
    const was = lb.open;
    S = set; O = opts;
    if (was) {
      const d = opts.dir || 1;
      lb.classList.remove("is-in");
      draw(opts.at || 0);
      if (!reduce()) anim(stage, [{ opacity: 0, transform: `translateX(${40 * d}px)` }, { opacity: 1, transform: "none" }], { duration: 600, easing: OUT }, cancel);
      requestAnimationFrame(() => lb.classList.add("is-in"));
      if (pushed && set.url) history.replaceState({ lb: set.url }, "", set.url);
      return;
    }
    opener = opts.from || null;
    const media = opener && (opener.matches("img") ? opener : $("img", opener));
    const r = rectOf(media) || rectOf(opener);
    document.documentElement.classList.add("lb-open");
    lb.showModal();
    draw(opts.at || 0);
    lb.classList.remove("is-in");
    if (r && !reduce()) {
      anim(lb, [{ clipPath: inset(r) }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }], { duration: 780, easing: EASE }, cancel);
      setTimeout(() => lb.classList.add("is-in"), 220);
    } else {
      if (!reduce()) anim(lb, [{ opacity: 0 }, { opacity: 1 }], { duration: 260 }, cancel);
      requestAnimationFrame(() => lb.classList.add("is-in"));
    }
    (mode === "sheet" ? sheet : track).focus({ preventScroll: true });
    pushed = false;
    if (opts.history && set.url && canPush()) {
      try { history.pushState({ lb: set.url }, "", set.url); pushed = true; } catch (e) { /* a file: page */ }
    }
  }

  function go(d) {
    const t = d > 0 ? O.next : O.prev;
    if (t && typeof t.go === "function") t.go(d);
  }

  function close(fromHistory) {
    if (!lb || !lb.open || closing) return;
    if (!fromHistory && pushed) { history.back(); return; }
    closing = true;
    const back = (O.returnTo && O.returnTo()) || opener;
    const r = rectOf(back && (back.matches("img") ? back : $("img", back))) || rectOf(back);
    const done = () => {
      lb.close();
      lb.classList.remove("is-in", "is-loupe", "is-sheet");
      loupe = false;
      $("[data-loupe]", lb).setAttribute("aria-pressed", "false");
      lens.classList.remove("is-on");
      track.innerHTML = ""; strip.innerHTML = ""; sheet.innerHTML = "";
      document.documentElement.classList.remove("lb-open");
      closing = false; pushed = false; waiting = null;
      const focusTo = back && (back.matches("a, button") ? back : $("a:not([tabindex='-1']), button:not([tabindex='-1'])", back.closest("li, article, figure") || back));
      if (focusTo) focusTo.focus({ preventScroll: true });
      if (O.onClose) O.onClose();
    };
    if (reduce()) { done(); return; }
    lb.classList.remove("is-in");
    const finish = a => { done(); a.cancel(); };
    if (r) anim(lb, [{ clipPath: "inset(0px 0px 0px 0px round 0px)" }, { clipPath: inset(r) }], { duration: 620, easing: EASE, fill: "forwards" }, finish);
    else anim(lb, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: "forwards" }, finish);
  }

  /* ---------- input ---------- */

  function stageLabel(e) {
    if (mode !== "single" || loupe || !S) return "";
    if (!e.target.closest("[data-lb-track]") || e.target.closest("button, a, iframe")) return "";
    const r = track.getBoundingClientRect();
    const left = e.clientX < r.left + r.width / 2;
    if (O.next && at === S.media.length) return left ? "← Back" : "";
    if (left) return at === 0 ? "" : "← Prev";
    return at >= lastSlide() ? "" : (O.next && at === S.media.length - 1 ? "End →" : "Next →");
  }
  function label(t) {
    if (t) cursorText.textContent = t;
    cursor.classList.toggle("is-on", !!t);
    lb.classList.toggle("has-label", !!t);
  }

  function wire() {
    lb.addEventListener("pointerdown", e => { lastPointer = e.pointerType; });
    lb.addEventListener("click", e => {
      const t = e.target;
      if (t.closest("[data-lb-close]")) return close();
      const sb = t.closest("[data-set]");
      if (sb) return go(+sb.dataset.set);
      const md = t.closest("[data-mode]");
      if (md) return setMode(md.dataset.mode);
      if (t.closest("[data-loupe]")) return toggleLoupe();
      const st = t.closest("[data-step]");
      if (st) return step(+st.dataset.step);
      const g = t.closest("[data-goto]");
      if (g) { at = +g.dataset.goto; if (mode === "sheet") setMode("single"); else setAt(at, true); return; }
      const pl = t.closest("[data-play]");
      if (pl) return play(+pl.dataset.play);
      const al = t.closest("[data-allow]");
      if (al) return askConsent(+al.dataset.allow);
      if (mode === "single" && !loupe && lastPointer === "mouse" && t.closest("[data-lb-track]") && !t.closest("a, button, iframe")) {
        const r = track.getBoundingClientRect();
        step(e.clientX < r.left + r.width / 2 ? -1 : 1);
      }
    });
    lb.addEventListener("cancel", e => { e.preventDefault(); close(); });
    lb.addEventListener("keydown", e => {
      if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if ((k === "ArrowRight" || k === "ArrowLeft") && e.shiftKey) { e.preventDefault(); go(k === "ArrowRight" ? 1 : -1); return; }
      if (k === "]" || k === "[") { go(k === "]" ? 1 : -1); return; }
      if (mode === "single" && (k === "ArrowRight" || k === "ArrowLeft")) {
        if (e.target.closest(".lb-mode, .lb-strip")) return;
        e.preventDefault(); step(k === "ArrowRight" ? 1 : -1); return;
      }
      if (k === "l" || k === "L") { toggleLoupe(); return; }
      if (k === "s" || k === "S") setMode(mode === "sheet" ? "single" : "sheet");
    });

    let ticking = false;
    track.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        if (i !== at) setAt(i, false);
      });
    }, { passive: true });
    new ResizeObserver(() => {
      if (!lb.open || mode !== "single") return;
      $$(".lb-frame img", track).forEach(fit);
      track.scrollLeft = at * track.clientWidth;
    }).observe(track);

    // the cursor says what a click on the stage will do
    const pos = { x: -300, y: -300, cx: -300, cy: -300 };
    let looping = false;
    const loop = () => {
      const k = reduce() ? 1 : 0.35;
      pos.cx += (pos.x - pos.cx) * k; pos.cy += (pos.y - pos.cy) * k;
      cursor.style.transform = `translate3d(${pos.cx}px, ${pos.cy}px, 0)`;
      if (Math.abs(pos.x - pos.cx) < 0.3 && Math.abs(pos.y - pos.cy) < 0.3) { looping = false; return; }
      requestAnimationFrame(loop);
    };
    lb.addEventListener("pointermove", e => {
      if (e.pointerType !== "mouse" || !fine.matches) return;
      pos.x = e.clientX; pos.y = e.clientY;
      label(stageLabel(e));
      if (!looping) { looping = true; requestAnimationFrame(loop); }
    }, { passive: true });
    track.addEventListener("pointerleave", () => { label(""); lens.classList.remove("is-on"); });

    // the loupe: 2.6x, read from the largest copy of the picture
    const Z = 2.6;
    track.addEventListener("pointermove", e => {
      if (!loupe || e.pointerType !== "mouse") return;
      const img = e.target.closest(".lb-frame img");
      if (!img || !img.classList.contains("is-loaded")) { lens.classList.remove("is-on"); return; }
      const r = img.getBoundingClientRect();
      const R = lens.offsetWidth / 2;
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const hi = img.currentSrc || img.src;
      if (lens.dataset.src !== hi) { lens.style.backgroundImage = `url("${hi}")`; lens.dataset.src = hi; }
      lens.style.backgroundSize = `${r.width * Z}px ${r.height * Z}px`;
      lens.style.backgroundPosition = `${R - x * Z}px ${R - y * Z}px`;
      lens.style.transform = `translate3d(${e.clientX - R}px, ${e.clientY - R}px, 0)`;
      lens.classList.add("is-on");
    });

    // Back closes the box the address bar opened; Forward to a set reloads it as its page
    addEventListener("popstate", e => {
      const s = e.state && e.state.lb;
      if (lb.open && !s) close(true);
      else if (!lb.open && s) location.href = s;
    });
  }

  window.Lightbox = { read, load, open, close, filmEmbed, isOpen: () => !!(lb && lb.open) };
})();
