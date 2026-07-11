import cropRecords from "../data/crops.json" with { type: "json" };
import { z } from "zod";

import type { Tool } from "./tool.js";

interface CropRecord {
  crop: string;
  soilPhMin: number;
  soilPhMax: number;
  notes: string;
}

export const cropLookupInputSchema = z
  .object({
    crop: z.string().min(1)
  })
  .strict();

export type CropLookupInput = z.infer<typeof cropLookupInputSchema>;

export type CropLookupOutput =
  | { found: true; crop: CropRecord }
  | { found: false; crop: string };

const crops: readonly CropRecord[] = cropRecords;

export const cropLookupTool: Tool<CropLookupInput, CropLookupOutput> = {
  name: "lookup_crop",
  description: "Look up local soil requirements and growing notes for a crop.",
  inputSchema: cropLookupInputSchema,
  async execute({ crop }) {
    const normalizedCrop = crop.trim().toLowerCase();
    const record = crops.find((candidate) => candidate.crop === normalizedCrop);

    return record === undefined
      ? { found: false, crop: normalizedCrop }
      : { found: true, crop: record };
  }
};
