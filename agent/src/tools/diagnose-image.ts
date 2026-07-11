import { z } from "zod";

import type { Tool } from "./tool.js";

export const diagnosisInputSchema = z.object({
  imageBase64: z.string().min(20),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"])
}).strict();

export type DiagnosisInput = z.infer<typeof diagnosisInputSchema>;
export interface DiagnosisOutput {
  prediction: string;
  display_name: string;
  confidence: number;
  uncertain: boolean;
  guidance: string;
  alternatives: Array<{ display_name: string; confidence: number }>;
  scores: Array<{ display_name: string; confidence: number }>;
  model_scope: string;
}

export function createDiagnosisTool(fetchImpl: typeof fetch = fetch): Tool<DiagnosisInput, DiagnosisOutput> {
  return {
    name: "diagnose_crop_image",
    description: "Classify a corn leaf photo using the trained four-class PlantVillage model.",
    inputSchema: diagnosisInputSchema,
    async execute({ imageBase64, mediaType }) {
      const bytes = Uint8Array.from(Buffer.from(imageBase64, "base64"));
      const form = new FormData();
      form.append("image", new Blob([bytes], { type: mediaType }), "leaf-image");
      const baseUrl = process.env.MODEL_SERVICE_URL ?? "http://127.0.0.1:8001";
      const response = await fetchImpl(`${baseUrl}/predict`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`Classifier service failed: ${response.status}`);
      return (await response.json()) as DiagnosisOutput;
    }
  };
}

export const diagnosisTool = createDiagnosisTool();
