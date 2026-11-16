// backend/src/validators/shopAdmin.validators.ts — Shop admin (Commerce Phase 1, C1).
// Money is integer paise. The database repeats every rule below (constraints + shop_* functions).
import { z } from 'zod';

const paise = z.number().int().min(0).max(5_000_000); // ₹50,000 ceiling per unit — far above any grooming product
const positivePaise = paise.refine((v) => v > 0, 'Must be more than ₹0.');

export const shopProductIdParamSchema = z.object({ productId: z.string().uuid() });
export const shopImageParamSchema = z.object({ productId: z.string().uuid(), imageId: z.string().uuid() });
export const shopCategoryIdParamSchema = z.object({ categoryId: z.string().uuid() });

export const shopProductListQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  categoryId: z.string().uuid().optional(),
  includeDeleted: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const productFields = {
  categoryId: z.string().uuid().nullable(),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, 'SKU: letters, digits, dot, dash or underscore (max 40).'),
  name: z.string().trim().min(2, 'Name is too short.').max(120),
  description: z.string().trim().max(2000),
  brand: z.string().trim().max(60),
  mrpPaise: positivePaise,
  sellingPricePaise: positivePaise,
  wholesaleCostPaise: paise,
  stockBuffer: z.number().int().min(0).max(1000),
  maxPerOrder: z.number().int().min(1).max(20),
  isActive: z.boolean(),
  sameDayEligible: z.boolean(),
};

const priceBelowMrp = (b: { mrpPaise?: number; sellingPricePaise?: number }) =>
  b.mrpPaise === undefined || b.sellingPricePaise === undefined || b.sellingPricePaise < b.mrpPaise;
const PRICE_MESSAGE = { message: 'Selling price must be lower than MRP.', path: ['sellingPricePaise'] };

export const shopCreateProductBodySchema = z
  .object({
    ...productFields,
    categoryId: productFields.categoryId.default(null),
    description: productFields.description.default(''),
    brand: productFields.brand.default(''),
    stockBuffer: productFields.stockBuffer.default(0),
    maxPerOrder: productFields.maxPerOrder.default(5),
    isActive: productFields.isActive.default(true),
    sameDayEligible: productFields.sameDayEligible.default(true),
    initialStock: z.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  .refine(priceBelowMrp, PRICE_MESSAGE);

// Partial update. If only one of MRP / selling price is sent, the database checks it against the stored other one.
export const shopUpdateProductBodySchema = z
  .object(productFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' })
  .refine(priceBelowMrp, PRICE_MESSAGE);

export const shopAvailabilityBodySchema = z.object({ available: z.boolean() }).strict();

export const shopStockChangeBodySchema = z
  .object({
    type: z.enum(['STOCK_COUNT', 'MANUAL_ADJUSTMENT', 'DAMAGED_STOCK']),
    qty: z.number().int().min(-100_000).max(100_000),
    expectedOnHand: z.number().int().min(0),
    reason: z.string().trim().max(300).default(''),
  })
  .strict()
  .refine((b) => b.type === 'STOCK_COUNT' || b.reason.length >= 3, {
    message: 'Please write a reason (at least 3 characters).',
    path: ['reason'],
  })
  .refine((b) => b.type !== 'STOCK_COUNT' || b.qty >= 0, { message: 'Count cannot be negative.', path: ['qty'] })
  .refine((b) => b.type !== 'DAMAGED_STOCK' || b.qty > 0, { message: 'Enter how many units are damaged.', path: ['qty'] })
  .refine((b) => b.type !== 'MANUAL_ADJUSTMENT' || b.qty !== 0, { message: 'Change cannot be 0.', path: ['qty'] });

export const shopStockCheckBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            counted: z.number().int().min(0).max(100_000),
            expectedOnHand: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .refine((b) => new Set(b.items.map((i) => i.productId)).size === b.items.length, {
    message: 'Each product can appear only once.',
  });

export const shopImageUpdateBodySchema = z
  .object({ sortOrder: z.number().int().min(0).max(100).optional(), alt: z.string().trim().max(120).optional() })
  .strict()
  .refine((b) => b.sortOrder !== undefined || b.alt !== undefined, { message: 'Nothing to update.' });

const categoryFields = {
  slug: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Short name: lowercase letters, digits and single dashes.'),
  nameEn: z.string().trim().min(1).max(60),
  nameHi: z.string().trim().max(60),
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
};
export const shopCreateCategoryBodySchema = z
  .object({
    ...categoryFields,
    nameHi: categoryFields.nameHi.default(''),
    sortOrder: categoryFields.sortOrder.default(0),
    isActive: categoryFields.isActive.default(true),
  })
  .strict();
export const shopUpdateCategoryBodySchema = z
  .object(categoryFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

const indianPhone = z
  .string()
  .trim()
  .regex(/^(\+91)?[6-9][0-9]{9}$|^$/, 'Enter a 10-digit mobile number (or leave empty).');

export const shopSettingsBodySchema = z
  .object({
    sameDayCutoff: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM (24-hour).')
      .nullable(),
    codMaxOrderPaise: z.number().int().min(10_000).max(5_000_000),
    maxOpenCodOrdersPerCustomer: z.number().int().min(1).max(10),
    founderContactPhone: indianPhone,
    placedReminderAfterMinutes: z.number().int().min(1).max(1440),
    placedReminderRepeatMinutes: z.number().int().min(5).max(1440),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

export const shopSupplierBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: indianPhone,
    notes: z.string().trim().max(1000),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

export const shopMovementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
