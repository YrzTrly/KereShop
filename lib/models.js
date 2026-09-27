import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const shopSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    category: { type: String, default: 'Fashion & Ankara' },
    bio: { type: String, default: '' },
    whatsapp: { type: String, default: '', lowercase: false },
    whatsappNumberId: { type: String, default: '' },
    whatsappAccountId: { type: String, default: '' },
    whatsappToken: { type: String, default: '' },
    instagram: { type: String, default: '' },
    currency: { type: String, default: 'NGN' },
    avatar: { type: String, default: '🛍️' },
  },
  { timestamps: true }
);

const productSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'Shop', index: true, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    image: { type: String, default: '' },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const customerSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'Shop', index: true, required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: '' },
    totalSpent: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },
    lastOrderAt: { type: Date, default: null },
    lastInteractionAt: { type: Date, default: null },
    preferences: { type: [String], default: [] },
    source: { type: String, default: 'storefront' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);
customerSchema.index({ shop: 1, phone: 1 }, { unique: true });

const orderItemSchema = new Schema(
  {
    name: { type: String, required: true },
    qty: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'Shop', index: true, required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    items: { type: [orderItemSchema], required: true },
    total: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'delivered', 'cancelled'],
      default: 'pending',
    },
    channel: {
      type: String,
      enum: ['storefront', 'whatsapp', 'voice', 'manual', 'instagram'],
      default: 'manual',
    },
    location: { type: String, default: '' },
    notes: { type: String, default: '' },
    transcript: { type: String, default: '' },
  },
  { timestamps: true }
);
orderSchema.index({ shop: 1, createdAt: -1 });

const getModel = (name, schema) => (mongoose.models[name] || model(name, schema));

export const Shop = getModel('Shop', shopSchema);
export const Product = getModel('Product', productSchema);
export const Customer = getModel('Customer', customerSchema);
export const Order = getModel('Order', orderSchema);