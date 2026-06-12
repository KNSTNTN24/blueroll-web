const COMBINE_SUFFIX =
  "\n\nThese images are photos or pages of a SINGLE recipe. " +
  "Combine them into ONE recipe — do not produce multiple recipes.";

export interface ImageInput { base64: string; mime?: string }

export interface ImportBody {
  text?: string;
  pdf_base64?: string;
  image_base64?: string;
  image_mime?: string;
  images?: ImageInput[];
}

type TextBlock = { type: "text"; text: string };
type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
type DocumentBlock = {
  type: "document";
  source: { type: "base64"; media_type: string; data: string };
};
export type ContentBlock = TextBlock | ImageBlock | DocumentBlock;

/** Pure: build the Claude `content` array from the request body + prompt. */
export function buildContent(body: ImportBody, prompt: string): ContentBlock[] {
  const { text, pdf_base64, image_base64, image_mime, images } = body;
  const content: ContentBlock[] = [];

  let imgs: ImageInput[] = [];
  if (Array.isArray(images) && images.length > 0) {
    imgs = images;
  } else if (image_base64) {
    imgs = [{ base64: image_base64, mime: image_mime }];
  }

  if (imgs.length > 0) {
    for (const im of imgs) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: im.mime || "image/jpeg",
          data: im.base64,
        },
      });
    }
    content.push({
      type: "text",
      text: imgs.length > 1 ? prompt + COMBINE_SUFFIX : prompt,
    });
  } else if (pdf_base64) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdf_base64 },
    });
    content.push({ type: "text", text: prompt });
  } else {
    content.push({
      type: "text",
      text: `Here is the recipe text to analyze:\n\n---\n${text ?? ""}\n---\n\n${prompt}`,
    });
  }
  return content;
}
