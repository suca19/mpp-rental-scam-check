import { z } from 'zod'

// Input contract for POST /check and POST /api/demo-check (PROJECT_SPEC.md).
// Only description, monthly_rent_eur and area are required.
export const ListingSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().min(1, 'description must not be empty').max(5000),
  monthly_rent_eur: z.number().positive().max(100_000),
  area: z.string().trim().min(1, 'area must not be empty').max(120),
  bedrooms: z.number().int().min(0).max(20).optional(),
  contact: z
    .object({
      phone: z.string().trim().max(40).optional(),
      email: z.string().trim().max(254).optional(),
      iban: z.string().trim().max(50).optional(),
    })
    .optional(),
  viewing_offered: z.boolean().optional(),
})
export type Listing = z.infer<typeof ListingSchema>

export const ReportSchema = z
  .object({
    phone: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().min(1).max(254).optional(),
    iban: z.string().trim().min(1).max(50).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((r) => r.phone || r.email || r.iban, { message: 'give at least one of phone, email, iban' })
export type Report = z.infer<typeof ReportSchema>

/** Turns a zod error into one readable line, e.g. "monthly_rent_eur: Invalid input: expected number". */
export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
}
