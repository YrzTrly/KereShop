/**
 * Order text -> structured JSON.
 * Uses OpenAI gpt-4o-mini structured outputs when OPENAI_API_KEY is set;
 * otherwise a deterministic heuristic parser (labeled honestly in the UI).
 */

const SCHEMA = {
  name: 'parsed_order',
  strict: true,
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Customer full name, or empty string' },
    phone: { type: 'string', description: 'Phone number, digits only incl. country code, or empty string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'integer' },
        },
        required: ['name', 'qty'],
      },
    },
    location: { type: 'string', description: 'Delivery location, or empty string' },
    total: { type: 'integer', description: 'Total amount in shop currency, or 0' },
  },
  required: ['name', 'phone', 'items', 'location', 'total'],
};

async function parseWithOpenAI(text) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You extract Nigerian social-commerce order details from a seller\'s transcription of a customer message. Return only the structured JSON. Phone digits only with country code (234 prefix, no leading 0). qty is a positive integer. total is 0 unless explicitly stated.',
        },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return { ...JSON.parse(content), parsedBy: 'openai' };
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

  for (const m of t.matchAll(/\b(\d{1,3})\s*(?:x|×|\*)\s*([A-Za-z0-9][A-Za-z0-9&' -]{1,40}?)(?=\s*(?:,|;|\band\b|\.| total| next|\n|$))/gi)) {
    out.items.push({ name: m[2].trim(), qty: Math.max(1, parseInt(m[1], 10)) });
  }
  if (out.items.length === 0) {
    for (const m of t.matchAll(/\b(\d{1,3})\s+((?:[A-Za-z']+\s+)*(?:dress|headwrap|ankara|gele|corset|bead|bag|shoe|sneaker|pair|top|wrap|scarf|kanga|set|necklace|bracelet|gown|skirt|lace|fabric|crown|watch|phone|jacket|hoodie)(?:es|s)?)(?=\s*(?:,|;|\band\b|\.| total| next|\n|$)|\s+(?:please|for|to|at|in|call|deliver|and|with)\b)/gi)) {
      out.items.push({ name: m[2].trim(), qty: Math.max(1, parseInt(m[1], 10)) });
    }
  }
  if (out.items.length === 0) {
    for (const m of t.matchAll(/\b(\d{1,3})\s+((?:[A-Za-z&'-]+ ?){0,3}[A-Za-z&'-]+s?)(?=\s*(?:,|;| and\b| or\b|\.(?=\s|$)| total\b| next\b| for\b| to\b| at\b| with\b| please\b|\n|$))/g)) {
      const name = m[2].trim().replace(/[&'-\s]+$/, '').trim();
      if (name) out.items.push({ name, qty: Math.max(1, parseInt(m[1], 10)) });
    }
  }

  const locM = t.match(/(?:deliver(?:y)?\s+(?:to|at)|send(?:ing)?\s+to|pickup\s+(?:at|from)|located in|in)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3})/);
  if (locM) out.location = locM[1].trim();

  const totM = t.match(/(?:total(?:\s+amount)?\s*(?:is|:)?|pay(?:ing)?\s*(?:is|of|:)?|i'll pay)\s*₦?\s?([\d][\d]{0,9})/i);
  if (totM) out.total = parseInt(totM[1].replace(/,/g, ''), 10);

  return out;
}

export async function parseOrderText(text) {
  if (process.env.OPENAI_API_KEY) {
    try {
      return await parseWithOpenAI(text);
    } catch {
      const mock = parseOrderTextMock(text);
      mock.parseError = 'OpenAI call failed — used heuristic parser';
      return mock;
    }
  }
  return parseOrderTextMock(text);
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
    // token overlap: "ankara dress" matches "Ankara Wrap Dress"
    const tokens = n.split(/[^a-z0-9]+/).filter((x) => x.length > 2);
    const pTokens = pn.split(/[^a-z0-9]+/).filter((x) => x.length > 2);
    const overlap = tokens.filter((tk) => pTokens.includes(tk)).length;
    if (tokens.length > 0 && overlap / Math.min(tokens.length, pTokens.length) >= 0.6) return p;
  }
  return null;
}