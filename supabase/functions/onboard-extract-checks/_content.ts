/** Pure: split a base64 data URL (e.g. "data:image/png;base64,AAAA") into
 * the Anthropic media_type + raw base64 data. */
export function parseDataUrl(
  dataUrl: string,
): { media_type: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new Error("Invalid image data URL");
  }
  return { media_type: match[1], data: match[2] };
}

export type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
export type TextBlock = { type: "text"; text: string };

/** Pure: turn base64 data-URL images + a prompt into a Claude content array. */
export function buildContent(
  images: string[],
  prompt: string,
): (ImageBlock | TextBlock)[] {
  const imageBlocks: ImageBlock[] = images.map((dataUrl) => {
    const { media_type, data } = parseDataUrl(dataUrl);
    return { type: "image", source: { type: "base64", media_type, data } };
  });
  return [...imageBlocks, { type: "text", text: prompt }];
}
