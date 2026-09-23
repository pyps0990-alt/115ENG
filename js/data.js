const cache = new Map();

async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

export const loadIndex = () => getJSON('data/lessons/index.json');
export const loadUnit = (id) => getJSON(`data/lessons/${encodeURIComponent(id)}.json`);

export const KIND_LABEL = { vocab: '單字', reading: '閱讀', grammar: '文法', cloze: '克漏字' };
