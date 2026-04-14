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

/** Normalize collection name: "Font theme/EN" → "Font theme" */
function normalizeCollection(collection: string): string {
  return (collection.split("/")[0] ?? collection).trim();
}

/**
 * Build a lookup map: Figma variable name → CSS variable name (with namespace).
 * Used to resolve alias references to the correct --namespace-leaf form.
 * Only covers non-typescale (ungrouped) variables.
 */
function buildVarLookup(variables: FigmaVariable[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of variables) {
    const normalized = normalizeCollection(v.collection);
    const namespace = COLLECTION_NAMESPACE[normalized.toLowerCase()];
    const leaf = v.name.substring(v.name.lastIndexOf("/") + 1);
    const kebab = toKebabCase(leaf);
    const cssName = namespace ? `--${namespace}-${kebab}` : `--${kebab}`;
    // Index by full name and by leaf name for flexible lookup
    map.set(v.name, cssName);
    map.set(leaf, cssName);
  }
  return map;
}

function resolveThemeVarName(v: FigmaVariable): string {
  const normalized = normalizeCollection(v.collection);
  const namespace = COLLECTION_NAMESPACE[normalized.toLowerCase()];
  const leaf = v.name.substring(v.name.lastIndexOf("/") + 1);
  const kebab = toKebabCase(leaf);
  return namespace ? `--${namespace}-${kebab}` : `--${kebab}`;
}

/**
 * Group variables by their direct parent segment (one level above the leaf).
 * e.g. "Color/hd-system/hd-green-50" → section "hd-system"
 *      "Color/hd-green-50"           → section "" (no sub-group)
 */
function groupBySection(variables: FigmaVariable[]): Map<string, FigmaVariable[]> {
  const map = new Map<string, FigmaVariable[]>();
  for (const v of variables) {
    const parts = v.name.split("/");
    const section = parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
    const list = map.get(section) ?? [];
    list.push(v);
    map.set(section, list);
  }
  return map;
}

/**
 * Detect typescale groups: variables from "Typescale/CH", "Typescale/EN" etc.
 * whose leaf names map to CSS properties and share the same parent path with 2+ siblings.
 *
 * Class name format: text-{lang}-{group}  e.g. .text-ch-h1, .text-en-h1
 * var() values are resolved via the varLookup map for precision.
 */
function detectTypescaleGroups(
  variables: FigmaVariable[],
  varLookup: Map<string, string>
): {
  groups: GroupedClass[];
  ungrouped: FigmaVariable[];
} {
  const parentMap = new Map<string, FigmaVariable[]>();
  const parentPathMap = new Map<string, string>(); // groupKey → actual parentPath
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
      const groupKey = `${v.collection}::${parentPath}`;
      const list = parentMap.get(groupKey) ?? [];
      list.push(v);
      parentMap.set(groupKey, list);
      parentPathMap.set(groupKey, parentPath);
    } else {
      ungrouped.push(v);
    }
  }

  const groups: GroupedClass[] = [];

  parentMap.forEach((vars, groupKey) => {
    const parentPath = parentPathMap.get(groupKey) ?? groupKey;
    if (vars.length < 2) {
      ungrouped.push(...vars);
      return;
    }

    // Build class name from collection language + group name
    // e.g. collection="Typescale/CH", parentPath="Typescale/CH/H1" → "text-ch-h1"
    // e.g. collection="Typescale",    parentPath="Typescale/H1"     → "text-h1"
    const collectionOfFirst = vars[0].collection;
    const collectionParts = collectionOfFirst.split("/");
    const lang = collectionParts.length >= 2
      ? toKebabCase(collectionParts[collectionParts.length - 1] ?? "")
      : null;

    // parentPath segments after the collection prefix
    const collectionPrefix = collectionOfFirst + "/";
    const groupPath = parentPath.startsWith(collectionPrefix)
      ? parentPath.substring(collectionPrefix.length)
      : parentPath.substring(parentPath.lastIndexOf("/") + 1);

    const groupKebab = toKebabCase(groupPath);
    const className = lang ? `text-${lang}-${groupKebab}` : `text-${groupKebab}`;

    const seenProps = new Set<string>();
    const properties: { cssProp: string; value: string }[] = [];

    for (const v of vars) {
      const leafName = v.name.substring(v.name.lastIndexOf("/") + 1).toLowerCase().trim();
      const cssProp = PROPERTY_MAP[leafName] ?? "";
      if (seenProps.has(cssProp)) continue;
      seenProps.add(cssProp);

      let value: string;
      if (v.isAlias) {
        const aliasTarget = v.aliasName ?? v.value;
        // Look up the precise CSS var name from the pre-built map
        const resolved = varLookup.get(aliasTarget)
          ?? varLookup.get(aliasTarget.substring(aliasTarget.lastIndexOf("/") + 1))
          ?? `--${toKebabCase(aliasTarget)}`;
        value = `var(${resolved})`;
      } else {
        value = formatValue(cssProp, v.value);
      }

      properties.push({ cssProp, value });
    }

    groups.push({ className, properties });
  });

  return { groups, ungrouped };
}

/** Wrap a font family name in quotes and append sans-serif fallback */
function formatFontFamily(value: string): string {
  const trimmed = value.trim();
  // Already quoted — leave as-is, just add fallback
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    return `${trimmed}, sans-serif`;
  }
  return `'${trimmed}', sans-serif`;
}

/** Add px units to ungrouped variables based on their collection namespace */
function formatValueByNamespace(collection: string, value: string): string {
  const ns = COLLECTION_NAMESPACE[collection.toLowerCase()];
  if (ns === "font") return formatFontFamily(value);
  // Namespaces whose values are numeric lengths needing px
  const pxNamespaces = new Set(["text", "leading", "tracking", "spacing", "radius"]);
  if (ns && pxNamespaces.has(ns)) {
    const num = Number.parseFloat(value);
    if (!Number.isNaN(num)) {
      if (ns === "tracking" && num === 0) return "normal";
      return `${num}px`;
    }
  }
  return value;
}

function formatValue(cssProp: string, value: string): string {
  if (cssProp === "font-family") return formatFontFamily(value);
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

  // Build lookup first (all variables, for alias resolution in typescale)
  const varLookup = buildVarLookup(variables);

  // Separate typescale variables from @theme vars
  const { groups, ungrouped } = detectTypescaleGroups(variables, varLookup);

  const parts: string[] = [];

  if (ungrouped.length > 0) {
    // Merge collections by normalized name, all into one @theme block
    const byCollection = new Map<string, FigmaVariable[]>();
    for (const v of ungrouped) {
      const key = normalizeCollection(v.collection);
      const list = byCollection.get(key) ?? [];
      list.push(v);
      byCollection.set(key, list);
    }

    const collectionBlocks: string[] = [];
    byCollection.forEach((vars, collection) => {
      const blockLines: string[] = [];
      blockLines.push(`  /* ${collection} */`);
      const sectionMap = groupBySection(vars);
      sectionMap.forEach((sVars, section) => {
        if (section) {
          blockLines.push(`  /* ${section} */`);
        }
        for (const v of sVars) {
          const cssName = resolveThemeVarName(v);
          const aliasTarget = v.aliasName ?? v.value;
          const cssValue = v.isAlias
            ? `var(${varLookup.get(aliasTarget) ?? "--" + toKebabCase(aliasTarget)})`
            : formatValueByNamespace(collection, v.value);
          blockLines.push(`  ${cssName}: ${cssValue};`);
        }
      });
      collectionBlocks.push(blockLines.join("\n"));
    });

    parts.push(`@theme {\n${collectionBlocks.join("\n\n")}\n}`);
  }

  const classes = generateClasses(groups);
  if (classes) parts.push(classes);

  return parts.join("\n\n") + "\n";
}

export function generateCSSParts(variables: FigmaVariable[]): { theme: string; typescale: string } {
  if (variables.length === 0) return { theme: "", typescale: "" };

  const varLookup = buildVarLookup(variables);
  const { groups, ungrouped } = detectTypescaleGroups(variables, varLookup);

  let theme = "";
  if (ungrouped.length > 0) {
    const byCollection = new Map<string, FigmaVariable[]>();
    for (const v of ungrouped) {
      const key = normalizeCollection(v.collection);
      const list = byCollection.get(key) ?? [];
      list.push(v);
      byCollection.set(key, list);
    }
    const collectionBlocks: string[] = [];
    byCollection.forEach((vars, collection) => {
      const blockLines: string[] = [];
      blockLines.push(`  /* ${collection} */`);
      const sectionMap = groupBySection(vars);
      sectionMap.forEach((sVars, section) => {
        if (section) blockLines.push(`  /* ${section} */`);
        for (const v of sVars) {
          const cssName = resolveThemeVarName(v);
          const aliasTarget = v.aliasName ?? v.value;
          const cssValue = v.isAlias
            ? `var(${varLookup.get(aliasTarget) ?? "--" + toKebabCase(aliasTarget)})`
            : formatValueByNamespace(collection, v.value);
          blockLines.push(`  ${cssName}: ${cssValue};`);
        }
      });
      collectionBlocks.push(blockLines.join("\n"));
    });
    theme = `@theme {\n${collectionBlocks.join("\n\n")}\n}\n`;
  }

  const typescale = groups.length > 0 ? generateClasses(groups) + "\n" : "";

  return { theme, typescale };
}
