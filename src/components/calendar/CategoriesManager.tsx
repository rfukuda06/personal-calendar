"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/lib/api";
import {
  categoryCreateSchema,
  type CategoryCreate,
} from "@/schemas/category";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Category = {
  id: string;
  name: string;
  color: string;
};

const MAX_CATEGORIES = 8;

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function CategoriesManager() {
  const qc = useQueryClient();
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });

  const usedColors = new Set(categories.map((c) => c.color));
  const firstAvailableColor =
    PRESET_COLORS.find((c) => !usedColors.has(c)) ?? PRESET_COLORS[0];

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Add category</h2>
        {categories.length >= MAX_CATEGORIES ? (
          <p className="text-sm text-muted-foreground">
            You&apos;ve reached the maximum of {MAX_CATEGORIES} categories.
            Delete one to add another.
          </p>
        ) : (
          <CategoryForm
            usedColors={usedColors}
            initialColor={firstAvailableColor}
            onSubmit={async (values) => {
              await api.post("/api/categories", values);
              qc.invalidateQueries({ queryKey: ["categories"] });
            }}
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Your categories</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No categories yet. Add one above.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                usedColors={usedColors}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CategoryRow({
  category,
  usedColors,
}: {
  category: Category;
  usedColors: Set<string>;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const del = useMutation({
    mutationFn: () => api.del(`/api/categories/${category.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  if (editing) {
    // When editing, the row's own color isn't "taken" — let the user keep it.
    const taken = new Set(usedColors);
    taken.delete(category.color);
    return (
      <li className="p-3">
        <CategoryForm
          defaultValues={{ name: category.name, color: category.color }}
          submitLabel="Save"
          usedColors={taken}
          onSubmit={async (values) => {
            await api.patch(`/api/categories/${category.id}`, values);
            qc.invalidateQueries({ queryKey: ["categories"] });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-4 p-3">
      <div className="flex items-center gap-3">
        <span
          className="inline-block size-4 rounded-full border"
          style={{ backgroundColor: category.color }}
          aria-hidden
        />
        <span className="font-medium">{category.name}</span>
        <span className="text-xs text-muted-foreground">{category.color}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (confirm(`Delete "${category.name}"?`)) del.mutate();
          }}
          disabled={del.isPending}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

function CategoryForm({
  defaultValues,
  initialColor,
  usedColors,
  onSubmit,
  onCancel,
  submitLabel = "Add",
}: {
  defaultValues?: CategoryCreate;
  /** Used when adding: which preset to seed the form with. */
  initialColor?: string;
  /** Colors already taken by other categories (disabled in the swatch row). */
  usedColors?: Set<string>;
  onSubmit: (values: CategoryCreate) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const seededColor =
    defaultValues?.color ?? initialColor ?? PRESET_COLORS[0];
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CategoryCreate>({
    resolver: zodResolver(categoryCreateSchema),
    defaultValues: defaultValues ?? { name: "", color: seededColor },
  });

  const color = watch("color");

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        try {
          await onSubmit(values);
          if (!defaultValues) reset({ name: "", color: seededColor });
        } catch (err) {
          alert((err as Error).message);
        }
      })}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex-1 min-w-40 space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} placeholder="Work" />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Color</Label>
        <input type="hidden" {...register("color")} />
        <div className="flex gap-1">
          {PRESET_COLORS.map((c) => {
            const taken = usedColors?.has(c) ?? false;
            return (
              <button
                type="button"
                key={c}
                disabled={taken}
                onClick={() => setValue("color", c, { shouldValidate: true })}
                className="relative size-6 overflow-hidden rounded-full border disabled:cursor-not-allowed"
                style={{
                  backgroundColor: c,
                  outline: color === c ? "2px solid currentColor" : "none",
                  outlineOffset: 2,
                }}
                aria-label={c}
                title={taken ? "Already used by another category" : c}
              >
                {taken && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rotate-45 bg-red-600"
                  />
                )}
              </button>
            );
          })}
        </div>
        {errors.color && (
          <p className="text-xs text-destructive">{errors.color.message}</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
