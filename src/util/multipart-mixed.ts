const textEncoder = new TextEncoder();

export const BOUNDARY = `-boundary-${Bun.randomUUIDv7("base64url")}`;
const LB = "\r\n";

export class MultipartMixed {
  readonly stream: ReadableStream<Uint8Array>;

  #first = true;
  #writer: WritableStreamDefaultWriter;

  constructor() {
    const { readable, writable } = new TransformStream<Uint8Array>();
    this.#writer = writable.getWriter();
    this.stream = readable;
  }

  async part({
    filename,
    payload,
    contentType = typeof payload === "string"
      ? "text/plain"
      : payload != undefined
      ? "application/json"
      : undefined,
  }: {
    filename?: string;
    contentType?: string;
    payload?: any;
  } = {}) {
    const headers = [] as string[];
    if (filename)
      headers.push(`Content-Disposition: attachment; filename="${filename}"`);
    if (contentType) headers.push(`Content-Type: ${contentType}`);

    const lines: string[] = [
      `--${BOUNDARY}`,
      headers.join(LB),
      `${LB}${
        payload
          ? typeof payload === "string"
            ? payload
            : JSON.stringify(payload)
          : ""
      }`,
    ];

    const first = this.#first;
    this.#first = false;
    await this.#write(
      textEncoder.encode(`${first ? "" : LB}${lines.join(LB)}`)
    );
  }

  async write(chunk: Uint8Array) {
    await this.#write(chunk);
  }

  async end() {
    await this.#write(END);
    this.#writer.close();
  }

  async #write(chunk: Uint8Array) {
    await this.#writer.write(chunk);
  }
}

const END = textEncoder.encode(`${LB}--${BOUNDARY}--${LB}`);
