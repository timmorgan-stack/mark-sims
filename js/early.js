/* Runs in the head, before the page paints: says scripts are on, so content that
   reveals on scroll starts hidden rather than flashing. A file, not an inline
   script: a codanomiq page's security policy runs no inline script. */
document.documentElement.classList.add("js");
