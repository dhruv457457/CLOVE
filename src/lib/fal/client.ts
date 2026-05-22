import "server-only";
import { createFalClient } from "@fal-ai/client";

export interface StrategyImageResult {
  imageUrl: string;
  width: number;
  height: number;
  prompt: string;
}

/**
 * Generate a strategy visualization image using fal.ai flux/schnell.
 * Returns a URL to an AI-generated diagram/visualization of the DeFi strategy.
 */
export async function generateStrategyImage(
  strategyDescription: string,
  protocol: string = "Morpho",
  bestApy?: number
): Promise<StrategyImageResult> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY not set");

  const fal = createFalClient({ credentials: apiKey });

  const prompt = [
    "Futuristic dark-themed DeFi dashboard visualization,",
    `${protocol} protocol yield strategy workflow diagram,`,
    bestApy ? `${bestApy}% APY displayed prominently,` : "",
    "glowing green neon circuit nodes connected by light beams,",
    "cyberpunk aesthetic, deep dark background #060a08,",
    "emerald green (#1aad89) accent colors, matrix-style data flows,",
    "ultra-detailed 4K, cinematic lighting, no text overlays,",
    strategyDescription.slice(0, 80),
  ].filter(Boolean).join(" ");

  const result = await fal.subscribe("fal-ai/flux/schnell", {
    input: {
      prompt,
      image_size: "landscape_16_9",
      num_inference_steps: 4,
      num_images: 1,
    },
  }) as { data: { images: Array<{ url: string; width: number; height: number }> } };

  const image = result.data?.images?.[0];
  if (!image?.url) throw new Error("fal.ai returned no image");

  return {
    imageUrl: image.url,
    width: image.width,
    height: image.height,
    prompt,
  };
}
