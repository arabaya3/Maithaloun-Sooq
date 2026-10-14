import { Fragment } from "react";

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] };

const BULLET = /^\s*[-•*–]\s+/;
const NUMBER = /^\s*\d+[.)-]\s+/;

/** Turns the owner's plain text into blocks: blank lines split paragraphs, «-» or «1.» lines become lists. */
export function descriptionBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  // Text pasted from elsewhere sometimes carries a literal «\n» meant as a line break.
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
  for (const chunk of normalized.split(/\n\s*\n/)) {
    for (const raw of chunk.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const last = blocks.at(-1);
      if (BULLET.test(line)) {
        const item = line.replace(BULLET, "");
        if (last?.kind === "bullets") last.items.push(item);
        else blocks.push({ kind: "bullets", items: [item] });
      } else if (NUMBER.test(line)) {
        const item = line.replace(NUMBER, "");
        if (last?.kind === "numbers") last.items.push(item);
        else blocks.push({ kind: "numbers", items: [item] });
      } else if (last?.kind === "paragraph") {
        last.lines.push(line.trim());
      } else {
        blocks.push({ kind: "paragraph", lines: [line.trim()] });
      }
    }
    // A blank line always closes the current block.
    blocks.push({ kind: "paragraph", lines: [] });
  }
  return blocks.filter(
    (block) => block.kind !== "paragraph" || block.lines.length,
  );
}

export function ProductDescription({
  text,
  className = "product-description",
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={className} dir="auto">
      {descriptionBlocks(text).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>
            {block.lines.map((line, at) => (
              <Fragment key={at}>
                {at ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </p>
        ) : block.kind === "bullets" ? (
          <ul key={index}>
            {block.items.map((item, at) => (
              <li key={at}>{item}</li>
            ))}
          </ul>
        ) : (
          <ol key={index}>
            {block.items.map((item, at) => (
              <li key={at}>{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

// The owner's text often holds the usage instructions after a label line such as «طريقة الاستعمال:».
const USAGE_LABEL =
  /^\s*(?:طريقة\s+(?:الاستعمال|الاستخدام)|الاستعمال|الاستخدام|how\s+to\s+use|directions(?:\s+for\s+use)?|usage)\s*[:：]\s*(.*)$/i;

/** Splits description and usage at the first usage label; anything uncertain stays in the description. */
export function splitProductText(text: string): {
  description: string;
  usage: string | null;
} {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n/g, "\n").split("\n");
  const at = lines.findIndex((line) => USAGE_LABEL.test(line));
  if (at < 0) return { description: text, usage: null };
  const inline = lines[at]!.match(USAGE_LABEL)![1]!.trim();
  const usage = [inline, ...lines.slice(at + 1)].join("\n").trim();
  const description = lines.slice(0, at).join("\n").trim();
  if (!usage || !description) return { description: text, usage: null };
  return { description, usage };
}
