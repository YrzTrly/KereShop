/**
 * Order text -> structured JSON.
 * Uses the Gemini API (same helper/model fallback as voice parsing) when
 * GEMINI_API_KEY is set; otherwise a deterministic heuristic parser
 * (labeled honestly in the UI).
 */
import { geminiGenerateContent } from '@/lib/gemini.js';
import { normalizePhone } from '@/lib/format.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';

const GEMINI_TEXT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    customerName: { type: 'STRING', description: 'Customer name if mentioned, else empty string' },
    customerPhone: { type: 'STRING', description: 'Phone number digits if mentioned, else empty string' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          product: { type: 'STRING', description: 'Product name as mentioned' },
          quantity: { type: 'INTEGER' },
          unitPrice: {
            type: 'NUMBER',
            description: 'Unit price ONLY if the customer explicitly stated it, otherwise 0',
          },
        },
        required: ['product', 'quantity'],
      },
    },
    deliveryLocation: { type: 'STRING', description: 'Delivery location if mentioned, else empty string' },
    notes: { type: 'STRING', description: 'Any other details, else empty string' },
  },
  required: ['customerName', 'customerPhone', 'items', 'deliveryLocation', 'notes'],
};

function parseJsonLoose(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

async function parseWithGemini(text) {
  const { model: usedModel, body: data } = await geminiGenerateContent(
    GEMINI_API_BASE,
    process.env.GEMINI_API_KEY,
    GEMINI_MODEL,
    {
      contents: [
        {
          parts: [
            {
              text: `You are an order assistant for a small Nigerian social-commerce business.
Read the customer's order text and extract the order information.

Rules:
- Do NOT invent information. If something is not mentioned, leave it empty.
- Preserve Nigerian names and product names accurately.
- "two" -> 2, "five thousand naira" -> 5000.
- unitPrice must be 0 unless the customer explicitly stated a price.
- Return only the structured JSON.

Customer's order text:
"""${text}"""`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_TEXT_SCHEMA,
      },
    },
  );
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const parsed = parseJsonLoose(raw);
  return {
    name: parsed.customerName || '',
    phone: normalizePhone(parsed.customerPhone || ''),
    items: Array.isArray(parsed.items)
      ? parsed.items.map((it) => ({
          name: String(it.product || ''),
          qty: Math.max(1, Number(it.quantity) || 1),
          unitPrice: Number(it.unitPrice) > 0 ? Number(it.unitPrice) : 0,
        }))
      : [],
    location: parsed.deliveryLocation || '',
    total: 0,
    notes: parsed.notes || '',
    parsedBy: `gemini:${usedModel}`,
  };
}

/** Deterministic fallback parser — works on the demo phrases out of the box. */
export function parseOrderTextMock(text) {
  const t = String(text || '').trim();
  const out = { name: '', phone: '', items: [], location: '', total: 0, parsedBy: 'mock' };

  const phoneM = t.match(/(?:\+?234|\+?00234|0)?\s?(\d{3})[\s-]?(\d{3})[\s-]?(\d{4})(?!\d)/);
  if (phoneM) {
    const m = phoneM[0].replace(/[^\d]/g, '');
    out.phone = m.length <= 10 ? '234' + m : m;
  }

  const nameM =
    t.match(/(?:my name is|i am|i'm|this is|customer is|name is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})/) ||
    t.match(/^(?:Hello|Hi|Hey|hello|hi|hey)[,\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/) ||
    t.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:wants|wanna|would like|is ordering|ordering|ordered|is booking|is paying|like to order)\b/i) ||
    t.match(/\b(?:it's|its|for)\s+([A-Z][a-z]+(?:\s(?<![.,!?])[A-Z][a-z]+){0,2})(?=\s*(?:[,:]|\.|!|\?|$| and| my| number| will| is|'s|s order))/i);
  const PRONOUNS = new Set(['she', 'he', 'they', 'them', 'the', 'a', 'an', 'i', 'me', 'we', 'you', 'my', 'your', 'our', 'his', 'her', 'its', 'this', 'that']);
  const rawName = (nameM ? nameM[1] : '').trim().replace(/^(?:for|to|with|and|or|but|is|it|it's|its)\s+/i, '').trim();
  if (rawName && !PRONOUNS.has(rawName.toLowerCase()) && !/^(?:for|to|with)$/i.test(rawName)) out.name = rawName;

  const WORD_QTY = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const NUM = String.raw`(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)`;
  const ITEM = String.raw`([A-Za-z0-9][A-Za-z0-9&' -]*[A-Za-z0-9&'-])`;
  const BOUNDARY = String.raw`(?=\s*(?:,|;| and\b| or\b| to\b| at\b| in\b| for\b| with\b| please\b|\.(?=\s|$)|\n|$))`;
  const END = String.raw`(?=\s*(?:,|;| and\b| or\b| to\b| at\b| in\b| for\b| with\b| please\b| total\b| next\b|\.(?=\s|$)|\n|$))`;
  const CATEGORY = 'dress|headwrap|ankara|gele|corset|bead|bag|shoe|sneaker|pair|top|wrap|scarf|kanga|set|necklace|bracelet|gown|skirt|lace|fabric|crown|watch|phone|jacket|hoodie';

  const CONTAINERS = new Set([
    'bottle', 'bottles', 'bag', 'bags', 'pack', 'packs', 'packet', 'packets', 'box', 'boxes',
    'carton', 'cartons', 'can', 'cans', 'cup', 'cups', 'glass', 'glasses', 'pair', 'pairs',
    'sleeve', 'sleeves', 'tube', 'tubes', 'jar', 'jars', 'tin', 'tins', 'loaf', 'loaves',
    'piece', 'pieces', 'slice', 'slices', 'dozen', 'roll', 'rolls', 'unit', 'units',
  ]);
  const FILLERS = new Set([
    'please', 'thanks', 'thank', 'you', 'now', 'today', 'tomorrow', 'get', 'gets', 'some',
    'any', 'want', 'wants', 'need', 'needs', 'like', 'is', 'the', 'a', 'an',
  ]);
  const cleanName = (raw) => {
    let w = String(raw || '')
      .replace(/^\d+\s*/g, '')
      .replace(/\s+of\b/gi, ' ')
      .replace(/\s{2}/g, ' ')
      .replace(/^[\s&'-]+|[\s&'-]+$/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    // "2 bottles of Coke" -> "Coke", "water bottles" -> "water"
    while (w.length > 1 && CONTAINERS.has(w[0].toLowerCase())) w.shift();
    while (w.length > 1 && CONTAINERS.has(w[w.length - 1].toLowerCase())) w.pop();
    // "5 bananas please" -> "bananas"
    while (w.length > 1 && FILLERS.has(w[w.length - 1].toLowerCase())) w.pop();
    while (w.length > 1 && FILLERS.has(w[0].toLowerCase())) w.shift();
    return w.join(' ').trim();
  };
  const wordNumToInt = (s) => {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return n;
    return WORD_QTY[String(s).toLowerCase()] || 1;
  };
  const pushItem = (rawName, qty) => {
    const name = cleanName(rawName);
    if (name && name !== 'of') out.items.push({ name, qty: Math.max(1, wordNumToInt(qty)) });
  };

  const found = [];
  const addRange = (start, end, name, qty) => found.push({ start, end, name, qty, branch: found.length });

  // "2 x item" / "2×item" / "2*item"
  for (const m of t.matchAll(new RegExp(String.raw`\b${NUM}\s*(?:x|×|\*)\s*` + ITEM + END, 'gi'))) {
    addRange(m.index, m.index + m[0].length, m[2], m[1]);
  }
  // "N <known category noun>" e.g. "2 bags", "3 ankara sets"
  for (const m of t.matchAll(new RegExp(String.raw`\b${NUM}\s+(?:[A-Za-z']+ ?){0,3}(?:${CATEGORY})(?:es|s)?` + END, 'gi'))) {
    addRange(m.index, m.index + m[0].length, m[0].slice(m[0].search(new RegExp(NUM, 'i')) + m[1].length), m[1]);
  }
  // generic "N item" — up to 3 words, must stop at a clear boundary
  for (const m of t.matchAll(new RegExp(String.raw`\b${NUM}\s+(?:[A-Za-z&'-]+ ?){0,2}[A-Za-z&'-]+s?` + END, 'g'))) {
    addRange(m.index, m.index + m[0].length, m[0].slice(m[0].search(new RegExp(NUM, 'i')) + m[1].length), m[1]);
  }
  // word quantities: "one Coke, two Fanta"
  for (const m of t.matchAll(new RegExp(String.raw`\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+([A-Z][A-Za-z0-9'-]+)` + BOUNDARY, 'g'))) {
    addRange(m.index, m.index + m[0].length, m[2], WORD_QTY[m[1].toLowerCase()]);
  }

  // Merge: sort by position (branch order breaks ties), keep non-overlapping ranges.
  const sorted = found.sort((a, b) => a.start - b.start || a.branch - b.branch);
  const merged = [];
  for (const r of sorted) {
    if (r.end <= 0) continue;
    if (merged.some((k) => r.end > k.start && r.start < k.end)) continue;
    merged.push(r);
  }
  for (const r of merged) pushItem(r.name, r.qty);

  const locM = t.match(/(?:deliver(?:y)?\s+(?:to|at)|send(?:ing)?\s+to|pickup\s+(?:at|from)|located in|in)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3})/);
  if (locM) out.location = locM[1].trim();

  const totM = t.match(/(?:total(?:\s+amount)?\s*(?:is|:)?|pay(?:ing)?\s*(?:is|of|:)?|i'll pay)\s*₦?\s?([\d][\d]{0,9})/i);
  if (totM) out.total = parseInt(totM[1].replace(/,/g, ''), 10);

  return out;
}

export async function parseOrderText(text) {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await parseWithGemini(text);
    } catch (e) {
      const mock = parseOrderTextMock(text);
      mock.parseError = `Gemini call failed (${String(e.message || e).slice(0, 120)}) — used heuristic parser`;
      return mock;
    }
  }
  const mock = parseOrderTextMock(text);
  mock.parseError = mock.parseError || 'No GEMINI_API_KEY configured — used heuristic parser';
  return mock;
}

/** Fuzzy-match a parsed item name against shop product names. */
export function matchProduct(itemName, products) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const n = norm(itemName);
  if (!n) return null;
  for (const p of products) {
    const pn = norm(p.name);
    if (pn === n) return p;
  }
  for (const p of products) {
    const pn = norm(p.name);
    if (pn.includes(n) || n.includes(pn)) return p;
    // token overlap with light stemming: "Oreos"~"Oreo", "T-shirts"~"T-Shirt",
    // "Lay-Classic"~"Lay's Classic"; tokenize the RAW names (norm() squashes
    // spaces, so tokenizing pn would collapse multi-word names to one blob)
    const stem = (s) => (s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s);
    const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const tokens = words(itemName).filter((x) => x.length > 2);
    const pWords = words(p.name).filter((x) => x.length > 2).map(stem);
    const pSet = new Set(pWords);
    const overlap = tokens.filter((tk) => pSet.has(stem(tk))).length;
    if (tokens.length > 0 && overlap / Math.min(tokens.length, pSet.size) >= 0.6) return p;
    // whole-word containment only — "coke" must not match "Aso Oke Shirt"
    // via the raw substring "oke" (word boundaries survive space-stripping)
    if (n.length > 3 && pWords.some((pw) => new RegExp(`(^|[^a-z0-9])${pw}([^a-z0-9]|$)`).test(n))) return p;
  }
  return null;
}