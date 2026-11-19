// Recipe Finder backend using the Spoonacular API. Node 18+, no npm packages.
// Run:  SPOONACULAR_API_KEY=your_key node server.js
const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.SPOONACULAR_API_KEY;
const PORT = process.env.PORT || 3000;
const BASE = 'https://api.spoonacular.com';
if (!KEY) { console.error('Set SPOONACULAR_API_KEY first.'); process.exit(1); }

// --- tiny helpers ---------------------------------------------------------
const hits = new Map(); // per-IP limit: 10 searches / minute
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr); return arr.length > 10;
}
const cache = new Map(); // saves your daily points: same search within 1 hour reuses the answer
const clean = s => String(s || '').replace(/[\r\n,]+/g, ' ').slice(0, 40).trim();
const fmt = n => String(Math.round(n * 100) / 100);

async function api(endpoint, params) {
  const url = new URL(BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { headers: { 'x-api-key': KEY } });
  if (r.status === 402) throw Object.assign(new Error('Daily Spoonacular quota used up'), { quota: true });
  if (!r.ok) throw new Error('Spoonacular ' + r.status + ' ' + await r.text());
  return r.json();
}

// Spoonacular has no filter for these on the "by ingredients" endpoint, so we check each recipe's data.
const DIETS = {
  vegetarian: r => r.vegetarian,
  vegan: r => r.vegan,
  'gluten-free': r => r.glutenFree,
  'dairy-free': r => r.dairyFree,
  pescatarian: r => (r.diets || []).some(d => /pesc/i.test(d)),
  ketogenic: r => (r.diets || []).some(d => /keto/i.test(d))
};

// --- main search ----------------------------------------------------------
async function search({ ingredients, cuisine, diet, servings, only }) {
  const have = (ingredients || []).slice(0, 15).map(clean).filter(Boolean);
  const n = Math.min(20, Math.max(1, parseInt(servings) || 2));
  const cu = clean(cuisine).toLowerCase(), di = clean(diet).toLowerCase();

  // 1) ranked matches: recipes that use the most of your ingredients first (pantry staples ignored)
  let found = await api('/recipes/findByIngredients', {
    ingredients: have.join(','), number: 20, ranking: 1, ignorePantry: 'true'
  });
  if (only) found = found.filter(f => f.missedIngredientCount === 0);
  if (!found.length) return [];
  const missed = new Map(found.map(f => [f.id, f.missedIngredients.map(m => m.name)]));

  // 2) full details for all of them in one request
  const full = await api('/recipes/informationBulk', { ids: found.map(f => f.id).join(',') });
  const order = new Map(found.map((f, i) => [f.id, i]));
  full.sort((a, b) => order.get(a.id) - order.get(b.id));

  return full
    .filter(r => !cu || (r.cuisines || []).some(c => c.toLowerCase() === cu))
    .filter(r => !di || (DIETS[di] ? DIETS[di](r) : true))
    .slice(0, 5)
    .map(r => {
      const f = n / (r.servings || n);
      const steps = ((r.analyzedInstructions || [])[0] || {}).steps || [];
      const desc = String(r.summary || '').replace(/<[^>]+>/g, '').split(/(?<=\.)\s/).slice(0, 2).join(' ').slice(0, 220);
      const link = /^https?:\/\/[^\s"'<>]+$/.test(r.sourceUrl || '') ? r.sourceUrl : '';
      return {
        name: r.title,
        cuisine: (r.cuisines || [])[0] || 'Various',
        time: r.readyInMinutes ? r.readyInMinutes + ' min' : '—',
        description: desc,
        ingredients: (r.extendedIngredients || []).map(i =>
          i.amount ? `${fmt(i.amount * f)} ${i.unit || ''} ${i.name}`.replace(/\s+/g, ' ').trim() : i.name),
        also_needed: only ? [] : missed.get(r.id) || [],
        steps: steps.length ? steps.map(s => s.step) : ['Full instructions are on the original recipe page.'],
        link
      };
    });
}

// --- server ---------------------------------------------------------------
http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  if (req.method === 'POST' && req.url === '/api/recipes') {
    if (limited(req.socket.remoteAddress)) { res.writeHead(429); return res.end('{}'); }
    let raw = ''; req.on('data', c => { raw += c; if (raw.length > 10000) req.destroy(); });
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw);
        if (!Array.isArray(body.ingredients) || !body.ingredients.length) throw new Error('no ingredients');
        const k = JSON.stringify([body.ingredients.map(clean).sort(), clean(body.cuisine), clean(body.diet), body.servings, !!body.only]);
        const hit = cache.get(k);
        let list;
        if (hit && Date.now() - hit.t < 3600000) list = hit.list;
        else { list = await search(body); cache.set(k, { t: Date.now(), list }); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ recipes: list }));
      } catch (e) {
        console.error(e.message);
        res.writeHead(e.quota ? 429 : 500); res.end('{}');
      }
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => console.log('Recipe Finder running at http://localhost:' + PORT));
