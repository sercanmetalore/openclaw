export type StructuredImportItem = {
  title: string;
  type: "epic" | "task" | "subtask";
  description?: string;
  children?: StructuredImportItem[];
};

type ParsedSection = {
  title: string;
  level: number;
  lines: string[];
  children: ParsedSection[];
};

type ParagraphBlock = {
  kind: "paragraph";
  lines: string[];
};

type ListEntry = {
  text: string;
  continuations: string[];
  children: ListEntry[];
};

type ListBlock = {
  kind: "list";
  items: ListEntry[];
};

type Block = ParagraphBlock | ListBlock;

function joinDescription(blocks: Array<string | undefined>): string | undefined {
  const normalized = blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block));
  return normalized.length ? normalized.join("\n\n") : undefined;
}

function cleanInlineMarkdown(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchBullet(line: string): { indent: number; text: string } | null {
  const match = line.match(/^(\s*)([-*+]|(?:\d+\.))\s+(.*)$/);
  if (!match) {
    return null;
  }
  return {
    indent: match[1]?.length ?? 0,
    text: cleanInlineMarkdown(match[3] ?? ""),
  };
}

function parseStructuredSections(content: string, markdown: boolean): {
  title?: string;
  root: ParsedSection;
} {
  const root: ParsedSection = { title: "", level: 0, lines: [], children: [] };
  const stack: ParsedSection[] = [root];
  let docTitle: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ").replace(/\s+$/u, "");
    if (markdown) {
      const heading = line.match(/^(\s*)(#{1,6})\s+(.*)$/);
      if (heading && (heading[1]?.length ?? 0) === 0) {
        const level = heading[2]?.length ?? 0;
        const title = cleanInlineMarkdown(heading[3] ?? "");
        if (title) {
          if (level === 1 && !docTitle && root.lines.length === 0 && root.children.length === 0) {
            docTitle = title;
            continue;
          }
          while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
            stack.pop();
          }
          const section: ParsedSection = { title, level, lines: [], children: [] };
          stack[stack.length - 1]!.children.push(section);
          stack.push(section);
          continue;
        }
      }
    }

    stack[stack.length - 1]!.lines.push(line);
  }

  return { title: docTitle, root };
}

function parseListBlock(lines: string[], start: number): { block: ListBlock; next: number } {
  const items: ListEntry[] = [];
  const stack: Array<{ indent: number; entry: ListEntry }> = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      break;
    }

    const bullet = matchBullet(line);
    if (bullet) {
      const entry: ListEntry = {
        text: bullet.text,
        continuations: [],
        children: [],
      };
      while (stack.length > 0 && bullet.indent <= stack[stack.length - 1]!.indent) {
        stack.pop();
      }
      if (stack.length > 0) {
        stack[stack.length - 1]!.entry.children.push(entry);
      } else {
        items.push(entry);
      }
      stack.push({ indent: bullet.indent, entry });
      index += 1;
      continue;
    }

    if (stack.length === 0) {
      break;
    }

    const current = stack[stack.length - 1]!.entry;
    const cleaned = cleanInlineMarkdown(line.trim());
    if (cleaned) {
      current.continuations.push(cleaned);
    }
    index += 1;
  }

  return { block: { kind: "list", items }, next: index };
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (matchBullet(line)) {
      const parsed = parseListBlock(lines, index);
      if (parsed.block.items.length > 0) {
        blocks.push(parsed.block);
      }
      index = parsed.next;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim() || matchBullet(current)) {
        break;
      }
      const cleaned = cleanInlineMarkdown(current.trim());
      if (cleaned) {
        paragraphLines.push(cleaned);
      }
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraphLines });
    }
  }

  return blocks;
}

function nextItemType(type: StructuredImportItem["type"]): StructuredImportItem["type"] {
  if (type === "epic") {
    return "task";
  }
  return "subtask";
}

function sectionType(level: number): StructuredImportItem["type"] {
  if (level <= 2) {
    return "epic";
  }
  if (level === 3) {
    return "task";
  }
  return "subtask";
}

function normalizeTitle(raw: string): string {
  return cleanInlineMarkdown(raw).replace(/:+$/u, "").trim();
}

function looksLikeIntroParagraph(text: string): boolean {
  return text.length > 70 && /[.!?]$/u.test(text) && !text.endsWith(":");
}

function buildParagraphItem(
  text: string,
  type: StructuredImportItem["type"],
): StructuredImportItem | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const titleCandidate = normalizeTitle(normalized);
  if (!titleCandidate) {
    return null;
  }

  if (normalized.length > 140) {
    const sentenceMatch = normalized.match(/^(.+?[.!?])(?:\s|$)/);
    const summary = normalizeTitle(sentenceMatch?.[1] ?? normalized.slice(0, 120));
    return {
      title: summary || titleCandidate,
      type,
      description: normalized,
    };
  }

  return {
    title: titleCandidate,
    type,
  };
}

function buildListEntryItem(
  entry: ListEntry,
  type: StructuredImportItem["type"],
): StructuredImportItem | null {
  const title = normalizeTitle(entry.text);
  if (!title) {
    return null;
  }

  const description = joinDescription(
    entry.continuations.map((line) => cleanInlineMarkdown(line)),
  );
  const childType = nextItemType(type);
  const children = entry.children
    .map((child) => buildListEntryItem(child, childType))
    .filter((item): item is StructuredImportItem => Boolean(item));

  return {
    title,
    type,
    description,
    children: children.length ? children : undefined,
  };
}

function buildChildrenFromBlocks(params: {
  blocks: Block[];
  childType: StructuredImportItem["type"];
}): { description?: string; children?: StructuredImportItem[] } {
  const descriptionParts: string[] = [];
  const children: StructuredImportItem[] = [];

  for (let index = 0; index < params.blocks.length; index += 1) {
    const block = params.blocks[index]!;
    if (block.kind === "paragraph") {
      const text = block.lines.join(" ").trim();
      if (!text) {
        continue;
      }

      const nextBlock = params.blocks[index + 1];
      if (nextBlock?.kind === "list" && text.endsWith(":")) {
        const groupChildren = nextBlock.items
          .map((entry) => buildListEntryItem(entry, nextItemType(params.childType)))
          .filter((item): item is StructuredImportItem => Boolean(item));
        children.push({
          title: normalizeTitle(text),
          type: params.childType,
          children: groupChildren.length ? groupChildren : undefined,
        });
        index += 1;
        continue;
      }

      if (children.length === 0 && looksLikeIntroParagraph(text)) {
        descriptionParts.push(text);
        continue;
      }

      const paragraphItem = buildParagraphItem(text, params.childType);
      if (paragraphItem) {
        children.push(paragraphItem);
      }
      continue;
    }

    children.push(
      ...block.items
        .map((entry) => buildListEntryItem(entry, params.childType))
        .filter((item): item is StructuredImportItem => Boolean(item)),
    );
  }

  return {
    description: joinDescription(descriptionParts),
    children: children.length ? children : undefined,
  };
}

function convertSectionToItem(section: ParsedSection, docTitle?: string): StructuredImportItem | null {
  const type = sectionType(section.level);
  const blocks = parseBlocks(section.lines);
  const childSections = section.children
    .map((child) => convertSectionToItem(child, docTitle))
    .filter((item): item is StructuredImportItem => Boolean(item));
  const blockResult = buildChildrenFromBlocks({
    blocks,
    childType: nextItemType(type),
  });

  const description = joinDescription([
    type === "epic" && docTitle ? `Document: ${docTitle}` : undefined,
    blockResult.description,
  ]);
  const children = [...(blockResult.children ?? []), ...childSections];

  return {
    title: section.title,
    type,
    description,
    children: children.length ? children : undefined,
  };
}

export function parseStructuredTextToItems(params: {
  content: string;
  markdown?: boolean;
}): { items: StructuredImportItem[] } {
  const markdown = params.markdown ?? false;
  const parsed = parseStructuredSections(params.content, markdown);

  if (parsed.root.children.length > 0) {
    const items = parsed.root.children
      .map((section) => convertSectionToItem(section, parsed.title))
      .filter((item): item is StructuredImportItem => Boolean(item));
    if (items.length > 0) {
      return { items };
    }
  }

  const rootBlocks = parseBlocks(parsed.root.lines);
  const rootResult = buildChildrenFromBlocks({
    blocks: rootBlocks,
    childType: parsed.title ? "task" : "task",
  });

  if (parsed.title) {
    return {
      items: [
        {
          title: parsed.title,
          type: "epic",
          description: rootResult.description,
          children: rootResult.children,
        },
      ],
    };
  }

  return {
    items: rootResult.children ?? [],
  };
}
