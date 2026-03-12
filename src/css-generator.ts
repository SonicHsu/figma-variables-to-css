export interface FigmaVariable {
  name: string;
  collection: string;
  type: string;
  value: string;
  isAlias: boolean;
  aliasName: string | null;
}

function toKebabCase(name: string): string {
  return name
    .replaceAll("/", "-")
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .replaceAll(/[\s_]+/g, "-")
    .toLowerCase();
}

// Map Figma collection names to Tailwind v4 @theme namespace prefixes
// https://tailwindcss.com/docs/v4-upgrade#renamed-utility-classes
const COLLECTION_NAMESPACE: Record<string, string> = {
  color: "color",
  colors: "color",
  "font theme": "font",
  "font family": "font",
  "font size": "text",
  "font-size": "text",
  "font weight": "font-weight",
  "font-weight": "font-weight",
  "font line height": "leading",
  "line height": "leading",
  "line-height": "leading",
  leading: "leading",
  "letter spacing": "tracking",
  "letter-spacing": "tracking",
  tracking: "tracking",
  spacing: "spacing",
  radius: "radius",
  shadow: "shadow",
};

// Map Figma variable leaf names to CSS properties (for typescale groups)
const PROPERTY_MAP: Record<string, string> = {
  font: "font-family",
  "font-family": "font-family",
  weight: "font-weight",
  "font-weight": "font-weight",
  size: "font-size",
  "font-size": "font-size",
  "line-height": "line-height",
  "line height": "line-height",
  leading: "line-height",
  "letter-spacing": "letter-spacing",
  "letter spacing": "letter-spacing",
  tracking: "letter-spacing",
};

interface GroupedClass {
  className: string;
  properties: { cssProp: string; value: string }[];
}

/**
 * Detect typescale groups: variables whose leaf names map to CSS properties
 * and share the same parent path with 2+ siblings.
 */
function detectTypescaleGroups(variables: FigmaVariable[]): {
  groups: GroupedClass[];
  ungrouped: FigmaVariable[];
} {
  const parentMap = new Map<string, FigmaVariable[]>();
  const ungrouped: FigmaVariable[] = [];

  for (const v of variables) {
    const lastSlash = v.name.lastIndexOf("/");
    if (lastSlash === -1) {
      ungrouped.push(v);
      continue;
    }

    const parentPath = v.name.substring(0, lastSlash);
    const leafName = v.name.substring(lastSlash + 1).toLowerCase().trim();
    const cssProp = PROPERTY_MAP[leafName];

    if (cssProp) {
      const list = parentMap.get(parentPath) ?? [];
      list.push(v);
      parentMap.set(parentPath, list);
    } else {
      ungrouped.push(v);
    }
  }

  const groups: GroupedClass[] = [];

  parentMap.forEach((vars, parentPath) => {
    if (vars.length < 2) {
      ungrouped.push(...vars);
      return;
    }

    const className = toKebabCase(parentPath);
    const seenProps = new Set<string>();
    const properties: { cssProp: string; value: string }[] = [];
    for (const v of vars) {
      const leafName = v.name.substring(v.name.lastIndexOf("/") + 1).toLowerCase().trim();
      const cssProp = PROPERTY_MAP[leafName]!;
      if (seenProps.has(cssProp)) continue;
      seenProps.add(cssProp);
      const value = v.isAlias
        ? `var(--${toKebabCase(v.aliasName ?? v.value)})`
        : formatValue(cssProp, v.value);
      properties.push({ cssProp, value });
    }

    groups.push({ className, properties });
  });

  return { groups, ungrouped };
}

function formatValue(cssProp: string, value: string): string {
  if (cssProp === "font-size" || cssProp === "line-height") {
    const num = Number.parseFloat(value);
    if (!Number.isNaN(num)) return `${num}px`;
  }
  if (cssProp === "letter-spacing") {
    const num = Number.parseFloat(value);
    if (!Number.isNaN(num)) return num === 0 ? "normal" : `${num}px`;
  }
  return value;
}

/**
 * Resolve the Tailwind @theme CSS variable name for a variable.
 * Uses collection name to determine the namespace prefix.
 * Variable name: only the leaf segment is used, stripping the collection prefix if present.
 *
 * Examples:
 *   collection="Color", name="Color/hd-green-50"  → --color-hd-green-50
 *   collection="Font Size", name="Font Size/h1"   → --text-h1
 *   collection="Font Theme", name="Font Theme/CN/body" → --font-cn-body
 */
function resolveThemeVarName(v: FigmaVariable): string {
  const collectionKey = v.collection.toLowerCase().trim();
  const namespace = COLLECTION_NAMESPACE[collectionKey];

  // Strip the collection name prefix from the variable path if present
  let namePath = v.name;
  const collectionPrefix = v.collection + "/";
  if (namePath.startsWith(collectionPrefix)) {
    namePath = namePath.substring(collectionPrefix.length);
  }

  // Convert remaining path to kebab-case (slashes become dashes)
  const kebab = toKebabCase(namePath);

  if (namespace) {
    return `--${namespace}-${kebab}`;
  }
  // Unknown collection: fall back to plain --var-name
  return `--${kebab}`;
}

/**
 * Group variables by their "section comment" for @theme output.
 * Section = the path excluding collection prefix and leaf name.
 * e.g. "Color/Neutral/hd-gray-50" → section "Neutral"
 */
function groupBySection(variables: FigmaVariable[]): Map<string, FigmaVariable[]> {
  const map = new Map<string, FigmaVariable[]>();
  for (const v of variables) {
    // Strip collection prefix
    let namePath = v.name;
    const collectionPrefix = v.collection + "/";
    if (namePath.startsWith(collectionPrefix)) {
      namePath = namePath.substring(collectionPrefix.length);
    }

    // Section = everything except the leaf
    const parts = namePath.split("/");
    const section = parts.length > 1 ? parts.slice(0, -1).join(" / ") : "";

    const list = map.get(section) ?? [];
    list.push(v);
    map.set(section, list);
  }
  return map;
}

function generateThemeBlock(variables: FigmaVariable[]): string {
  if (variables.length === 0) return "";

  const sectionMap = groupBySection(variables);
  const lines: string[] = [];

  sectionMap.forEach((vars, section) => {
    if (section) {
      lines.push(`  /* ${section} */`);
    }
    for (const v of vars) {
      const cssName = resolveThemeVarName(v);
      const cssValue = v.isAlias
        ? `var(--${toKebabCase(v.aliasName ?? v.value)})`
        : v.value;
      lines.push(`  ${cssName}: ${cssValue};`);
    }
  });

  return `@theme {\n${lines.join("\n")}\n}`;
}

function generateClasses(groups: GroupedClass[]): string {
  return groups
    .map((g) => {
      const props = g.properties
        .map((p) => `  ${p.cssProp}: ${p.value};`)
        .join("\n");
      return `.${g.className} {\n${props}\n}`;
    })
    .join("\n\n");
}

export function generateCSS(variables: FigmaVariable[]): string {
  if (variables.length === 0) return "";

  // Separate typescale variables (handled as utility classes) from theme vars
  const { groups, ungrouped } = detectTypescaleGroups(variables);

  const parts: string[] = [];

  // Group by collection → each collection gets its own @theme block
  const byCollection = new Map<string, FigmaVariable[]>();
  for (const v of ungrouped) {
    const list = byCollection.get(v.collection) ?? [];
    list.push(v);
    byCollection.set(v.collection, list);
  }

  byCollection.forEach((vars, collection) => {
    const block = generateThemeBlock(vars);
    if (block) {
      parts.push(`/* ${collection} */\n${block}`);
    }
  });

  const classes = generateClasses(groups);
  if (classes) parts.push(classes);

  return parts.join("\n\n") + "\n";
}
