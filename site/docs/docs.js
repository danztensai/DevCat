// Manual extras (the pages work without them): search over every page, and the contents list
// folded on small screens.
const box = document.querySelector(".search");
const input = document.getElementById("q");
const hits = document.getElementById("hits");
let index = null;

async function search(q) {
  index ??= await fetch("search.json").then((r) => r.json());
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const found = [];
  for (const p of index) {
    const hay = `${p.title} ${p.summary} ${p.text}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const heading = p.headings.find(([, h]) => words.some((w) => h.toLowerCase().includes(w)));
    const at = Math.max(0, p.text.toLowerCase().indexOf(words[0]));
    const snippet = p.text.slice(Math.max(0, at - 40), at + 90);
    const score = words.reduce((s, w) => s + (p.title.toLowerCase().includes(w) ? 10 : 0) + (heading ? 3 : 0), 0);
    found.push({ url: p.url + (heading ? `#${heading[0]}` : ""), title: heading ? `${p.title}: ${heading[1]}` : p.title, snippet, score });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 8);
}

if (box && input) {
  box.hidden = false;
  input.addEventListener("input", async () => {
    const q = input.value.trim();
    const list = q.length < 2 ? [] : await search(q).catch(() => []);
    hits.replaceChildren(...list.map((h) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = h.url;
      const t = document.createElement("strong");
      t.textContent = h.title;
      const s = document.createElement("span");
      s.textContent = `…${h.snippet.trim()}…`;
      a.append(t, s);
      li.append(a);
      return li;
    }));
    if (q.length >= 2 && !list.length) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = "No page mentions that. Try another word.";
      hits.append(li);
    }
  });
  // "/" focuses the search, like many docs sites.
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      input.focus();
    }
  });
}

// Small screens: start with the contents folded.
const side = document.querySelector("details.doc-side");
if (side && matchMedia("(max-width: 960px)").matches) side.open = false;
