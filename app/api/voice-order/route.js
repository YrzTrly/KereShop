import { db } from '@/lib/mongo.js';
import { getActiveShop } from '@/lib/shop-context.js';
import { Product } from '@/lib/models.js';
import { matchProduct } from '@/lib/parse-order.js';
import { normalizePhone } from '@/lib/format.js';
import { geminiGenerateContent } from '@/lib/gemini.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Audio can be long; allow ample time for the model call.
export const maxDuration = 60;

// lib/gemini.js owns the fallback chain, so this default only sets the
// primary candidate; Google's current recommendation per the deprecation
// notice for gemini-2.5-flash-lite.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    customerName: { type: 'STRING', description: 'Customer name if mentioned, else empty string' },
    customerPhone: { type: 'STRING', description: 'Phone number digits if mentioned, else empty string' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          product: { type: 'STRING', description: 'Product name as spoken' },
          quantity: { type: 'INTEGER' },
          unitPrice: {
            type: 'NUMBER',
            description:
              'Unit price ONLY if the customer explicitly stated it, otherwise 0. (A single type — never an array — is required by the Gemini API.)',
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

async function parseAudioWithGemini(base64, mimeType) {
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
Listen to the customer's voice order and extract the order information.

Rules:
- Do NOT invent information. If something is not mentioned, leave it empty or null.
- Preserve Nigerian names and product names accurately.
- "two" -> 2, "five thousand naira" -> 5000.
- unitPrice must be 0 unless the customer explicitly stated a price.
- Return only the structured JSON.`,
              },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      },
  );
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const parsed = parseJsonLoose(text);
  return {
    customerName: parsed.customerName || '',
    customerPhone: normalizePhone(parsed.customerPhone || ''),
    items: Array.isArray(parsed.items)
      ? parsed.items.map((it) => ({
          product: String(it.product || ''),
          quantity: Math.max(1, Number(it.quantity) || 1),
          unitPrice: Number(it.unitPrice) > 0 ? Math.max(0, Number(it.unitPrice)) : null,
        }))
      : [],
    deliveryLocation: parsed.deliveryLocation || '',
    notes: parsed.notes || '',
    engine: `gemini:${usedModel}`,
  };
}

export async function POST(req) {
  await db();
  try {
    const shop = await getActiveShop();
    const products = await Product.find({ shop: shop._id, active: true });

    let engine = null;
    let result = null;
    let audioMime = '';

    const type = (req.headers.get('content-type') || '').toLowerCase();

    if (type.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('audio');
      if (!(file instanceof File) || file.size === 0) {
        return Response.json({ error: 'No audio file provided' }, { status: 400 });
      }
      if (file.size > 10 * 1024 * 1024) {
        return Response.json({ error: 'Audio file too large (max 10MB)' }, { status: 400 });
      }
      audioMime = file.type || 'audio/webm';
      const buf = Buffer.from(await file.arrayBuffer());
      const base64 = buf.toString('base64');

      if (process.env.GEMINI_API_KEY) {
        try {
          result = await parseAudioWithGemini(base64, audioMime);
        } catch (e) {
          engine = 'demo-fallback';
          result = {
            customerName: 'Mama Tobi',
            customerPhone: normalizePhone('08031234567'),
            items: [{ product: 'Ankara Set', quantity: 2, unitPrice: null }],
            deliveryLocation: 'Ikeja, Lagos',
            notes: 'Demo transcript — add GEMINI_API_KEY for live transcription',
            engine: 'demo-fallback',
          };
          result.parseError = `${String(e.message || e).slice(0, 160)} — used demo transcript`;
        }
      } else {
        engine = 'demo';
        result = {
          customerName: 'Mama Tobi',
          customerPhone: normalizePhone('08031234567'),
          items: [{ product: 'Ankara Set', quantity: 2, unitPrice: null }],
          deliveryLocation: 'Ikeja, Lagos',
          notes: 'Demo transcript — no GEMINI_API_KEY configured, so this is a sample order',
          engine: 'demo',
        };
      }
    } else {
      const body = await req.json().catch(() => ({}));
      const text = String(body.text || '').trim();
      if (!text) {
        return Response.json({ error: 'Provide an audio file (multipart) or a "text" field' }, { status: 400 });
      }
      // Text path: reuse the existing OpenAI-or-heuristic parser.
      const { parseOrderText } = await import('@/lib/parse-order.js');
      const parsed = await parseOrderText(text);
      const textItems = (parsed.items || []).map((it) => ({
        product: it.name || '',
        quantity: Math.max(1, Number(it.qty) || 1),
        unitPrice: null,
      }));
      result = {
        customerName: parsed.name || '',
        customerPhone: normalizePhone(parsed.phone || ''),
        items: textItems,
        deliveryLocation: parsed.location || '',
        notes: '',
        engine: parsed.parseError ? `heuristic(${parsed.parseError})` : 'text',
      };
      if (textItems.length === 0) {
        result.parseError = parsed.parseError
          ? `${parsed.parseError} — and no items could be parsed from the text`
          : 'No items could be parsed from the text — try e.g. "2 Ankara sets, delivery to Ikeja"';
      }
    }

    // Attach shop prices from the catalog — never trust the AI for pricing.
    const items = result.items.map((it) => {
      const match = matchProduct(it.product, products);
      const catalogPrice = match ? match.price : null;
      return {
        product: it.product,
        quantity: it.quantity,
        unitPrice: catalogPrice != null ? catalogPrice : it.unitPrice,
        catalogMatch: match ? match.name : null,
        // Flag when the customer stated a different price than the catalog.
        priceMismatch:
          catalogPrice != null && it.unitPrice != null && it.unitPrice !== catalogPrice,
      };
    });

    const total = items.reduce((s, it) => s + (it.unitPrice || 0) * it.quantity, 0);

    let parseError = result.parseError || '';
    if (items.length === 0 && !parseError) {
      parseError = 'No items could be parsed — please check the audio and try again, or type the order instead';
    }

    return Response.json({
      success: true,
      engine: engine || result.engine,
      currency: shop.currency,
      order: {
        name: result.customerName,
        phone: result.customerPhone,
        items,
        location: result.deliveryLocation,
        notes: result.notes,
        total,
        parseError,
      },
    });
  } catch (e) {
    console.error('Voice order error:', e);
    return Response.json({ error: 'Could not process voice order' }, { status: 500 });
  }
}