declare module "heic-convert" {
  const convert: (input: {
    buffer: Buffer;
    format: "PNG" | "JPEG";
    quality?: number;
  }) => Promise<Buffer>;
  export default convert;
}
