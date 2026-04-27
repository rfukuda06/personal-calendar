import { z } from "zod";

// Hex color like "#ef4444" or "#EF4444".
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex like #ef4444");

export const categoryCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(40),
  color: hexColor,
});

export const categoryUpdateSchema = categoryCreateSchema.partial();

export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;
