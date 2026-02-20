import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, requireRole } from "@/lib/tenant";
import {
  dedupeParsedItems,
  extractMenuItemsFromFile,
  type ParsedMenuItem,
} from "@/lib/menuImport";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]);

const MAX_FILES = 20;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB per file

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER");
    const formData = await req.formData();
    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return apiError("Please upload at least one PDF/image file", 400);
    }
    if (files.length > MAX_FILES) {
      return apiError(`Maximum ${MAX_FILES} files allowed per import`, 400);
    }

    const extractedByFile: { file: string; items: ParsedMenuItem[] }[] = [];
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return apiError(
          `Unsupported file type for "${file.name}". Use PDF, PNG, JPG, WEBP or HEIC`,
          400,
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return apiError(`File "${file.name}" exceeds 8MB limit`, 400);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const base64 = buffer.toString("base64");
      const items = await extractMenuItemsFromFile(file.name, file.type, base64);
      extractedByFile.push({ file: file.name, items });
    }

    const allExtracted = dedupeParsedItems(
      extractedByFile.flatMap((entry) => entry.items),
    );

    if (allExtracted.length === 0) {
      return apiError(
        "No menu items with valid names and prices were detected in the scans",
        400,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const categories = await tx.menuCategory.findMany({
        where: { tenantId: session.tenantId },
      });
      const items = await tx.menuItem.findMany({
        where: { tenantId: session.tenantId },
      });

      const categoryByNormalizedName = new Map(
        categories.map((c) => [normalize(c.name), c]),
      );
      const itemByNormalizedName = new Map(
        items.map((i) => [normalize(i.name), i]),
      );

      const maxSortOrderAgg = await tx.menuCategory.aggregate({
        where: { tenantId: session.tenantId },
        _max: { sortOrder: true },
      });
      let nextSortOrder = (maxSortOrderAgg._max.sortOrder ?? -1) + 1;

      let categoriesCreated = 0;
      let itemsCreated = 0;
      let itemsUpdated = 0;
      let skippedAsDuplicate = 0;

      for (const parsedItem of allExtracted) {
        const normalizedName = normalize(parsedItem.name);
        const normalizedCategory = normalize(parsedItem.category);

        let category = categoryByNormalizedName.get(normalizedCategory);
        if (!category) {
          category = await tx.menuCategory.create({
            data: {
              tenantId: session.tenantId,
              name: parsedItem.category,
              sortOrder: nextSortOrder++,
              isActive: true,
            },
          });
          categoryByNormalizedName.set(normalizedCategory, category);
          categoriesCreated += 1;
        } else if (!category.isActive) {
          category = await tx.menuCategory.update({
            where: { id: category.id },
            data: { isActive: true },
          });
          categoryByNormalizedName.set(normalizedCategory, category);
        }

        const existingItem = itemByNormalizedName.get(normalizedName);
        if (existingItem) {
          const newDescription =
            parsedItem.description && parsedItem.description.length > 0
              ? parsedItem.description
              : existingItem.description;

          const shouldUpdate =
            Number(existingItem.price) !== parsedItem.price ||
            existingItem.description !== newDescription ||
            existingItem.isAvailable === false;

          if (shouldUpdate) {
            const updated = await tx.menuItem.update({
              where: { id: existingItem.id },
              data: {
                price: parsedItem.price,
                description: newDescription,
                isAvailable: true,
              },
            });
            itemByNormalizedName.set(normalizedName, updated);
            itemsUpdated += 1;
          } else {
            skippedAsDuplicate += 1;
          }
          continue;
        }

        const created = await tx.menuItem.create({
          data: {
            tenantId: session.tenantId,
            categoryId: category.id,
            name: parsedItem.name,
            price: parsedItem.price,
            description: parsedItem.description,
            isAvailable: true,
            variants: "[]",
          },
        });
        itemByNormalizedName.set(normalizedName, created);
        itemsCreated += 1;
      }

      return {
        categoriesCreated,
        itemsCreated,
        itemsUpdated,
        skippedAsDuplicate,
      };
    });

    return apiSuccess({
      message: "Menu import completed",
      summary: {
        filesProcessed: extractedByFile.length,
        extractedItems: allExtracted.length,
        ...result,
      },
    });
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("Menu scan import error:", error);
    return apiError(error.message || "Failed to import scanned menu", 500);
  }
}
